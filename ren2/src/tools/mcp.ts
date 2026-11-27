// mcp_client: minimal MCP client over Streamable HTTP (JSON-RPC 2.0 POSTs; responses may
// come back as JSON or as an SSE stream). Servers are listed in config/mcp.yaml.
// VERIFY against a live server: built from the MCP spec (initialize → notifications/
// initialized → tools/list | tools/call, Mcp-Session-Id header), not a captured response.
import path from 'node:path';
import { Tool, ToolError } from './types.js';
import { readYaml } from '../yaml.js';
import type { Core } from '../core.js';

interface ServerCfg {
  url: string;
  token_env?: string; // name of the .env var holding a bearer token
}

export function mcpServers(core: Core): Record<string, ServerCfg> {
  return readYaml<{ servers: Record<string, ServerCfg> }>(path.join(core.settings.configDir, 'mcp.yaml'), { servers: {} }).servers || {};
}

export function parseRpcBody(text: string, ct: string): any {
  if (ct.includes('text/event-stream')) {
    const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    for (const d of datas.reverse()) {
      try {
        const j = JSON.parse(d);
        if (j.result !== undefined || j.error !== undefined) return j;
      } catch {
        /* skip */
      }
    }
    throw new Error('no JSON-RPC result in SSE stream');
  }
  return JSON.parse(text);
}

export class McpSession {
  private sid: string | null = null;
  private n = 0;
  constructor(private cfg: ServerCfg, private signal?: AbortSignal) {}
  private async rpc(method: string, params: unknown, notify = false) {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.sid) headers['mcp-session-id'] = this.sid;
    if (this.cfg.token_env && process.env[this.cfg.token_env]) headers.authorization = `Bearer ${process.env[this.cfg.token_env]}`;
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++this.n, method, params };
    const r = await fetch(this.cfg.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([...(this.signal ? [this.signal] : []), AbortSignal.timeout(60_000)]) });
    this.sid = r.headers.get('mcp-session-id') || this.sid;
    if (notify) return null;
    const text = await r.text();
    if (!r.ok) throw new ToolError(`mcp ${method} HTTP ${r.status}: ${text.slice(0, 300)}`);
    const j = parseRpcBody(text, r.headers.get('content-type') || '');
    if (j.error) throw new ToolError(`mcp ${method}: ${j.error.message}`);
    return j.result;
  }
  async init() {
    await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ren2', version: '0.1.0' } });
    await this.rpc('notifications/initialized', {}, true);
  }
  listTools() {
    return this.rpc('tools/list', {});
  }
  callTool(name: string, args: unknown) {
    return this.rpc('tools/call', { name, arguments: args ?? {} });
  }
}

export const mcpTool: Tool = {
  name: 'mcp_client',
  description: 'Call an MCP server from config/mcp.yaml. args: { server, action: list|call, tool?, arguments? }.',
  async status(core) {
    const s = mcpServers(core);
    return Object.keys(s).length ? { status: 'ok', detail: Object.keys(s).join(', ') } : { status: 'needs_config', detail: 'no servers in config/mcp.yaml' };
  },
  async run(args, ctx) {
    const cfg = mcpServers(ctx.core)[args.server];
    if (!cfg) throw new ToolError(`unknown MCP server ${args.server}`);
    const s = new McpSession(cfg, ctx.signal);
    await s.init();
    const res = args.action === 'call' ? await s.callTool(args.tool, args.arguments) : await s.listTools();
    const text = args.action === 'call' && Array.isArray(res?.content) ? res.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : JSON.stringify(res, null, 1);
    return { output: text.slice(0, 20_000), data: res };
  },
};
