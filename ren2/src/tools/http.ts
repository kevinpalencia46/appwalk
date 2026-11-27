// http: outbound requests. GET to public hosts is allowed (research). Anything that
// writes (non-GET) is limited to hosts in config/http_hosts.yaml. Adapters use their own
// base URLs; this tool is for the open web. Private/loopback hosts are refused here so
// research can't poke the Pi's own services behind the adapters' backs.
import path from 'node:path';
import { Tool, ToolError } from './types.js';
import { readYaml } from '../yaml.js';
import { redact } from '../log.js';

const CAP = 200 * 1024;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function privateHost(h: string): boolean {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i.test(h) || h.endsWith('.local');
}

export const httpTool: Tool = {
  name: 'http',
  description: 'Fetch a public URL. args: { url, method?, body?, as?: "text"|"json"|"raw" }. HTML is converted to text.',
  async status() {
    return { status: 'ok' };
  },
  async run(args, ctx) {
    let u: URL;
    try {
      u = new URL(String(args.url));
    } catch {
      throw new ToolError(`bad url ${args.url}`);
    }
    if (!/^https?:$/.test(u.protocol)) throw new ToolError('only http(s)');
    if (privateHost(u.hostname)) throw new ToolError(`private host ${u.hostname} — use the project adapter instead`);
    const method = String(args.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      const allowed = readYaml<{ write_hosts: string[] }>(path.join(ctx.core.settings.configDir, 'http_hosts.yaml'), { write_hosts: [] }).write_hosts || [];
      if (!allowed.includes(u.hostname)) throw new ToolError(`${method} to ${u.hostname} not allowed (config/http_hosts.yaml)`);
    }
    const r = await fetch(u, {
      method,
      headers: { 'user-agent': 'ren2/0.1 (+research bot)', ...(args.body ? { 'content-type': 'application/json' } : {}) },
      body: args.body ? JSON.stringify(args.body) : undefined,
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]),
      redirect: 'follow',
    });
    const raw = (await r.text()).slice(0, CAP);
    const ct = r.headers.get('content-type') || '';
    const text = args.as === 'raw' ? raw : ct.includes('html') ? htmlToText(raw) : raw;
    const out = redact(`HTTP ${r.status} ${u.href}\n\n${text.slice(0, 20_000)}`);
    if (!r.ok && !args.allow_fail) throw new ToolError(out.slice(0, 1000));
    return { output: out, data: { status: r.status, contentType: ct } };
  },
};
