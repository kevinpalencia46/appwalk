import type { Core } from '../core.js';
import { Tool } from './types.js';
import { shellTool } from './shell.js';
import { filesTool } from './files.js';
import { httpTool } from './http.js';
import { claudeCodeTool } from './claude_code.js';
import { mcpTool } from './mcp.js';
import { memoryTool, thinkTool, handoffTool, notifyTool } from './core_tools.js';
import { adapterTool, publishTool, systemTool } from './actions.js';

export class Tools {
  private map = new Map<string, Tool>();
  constructor(tools: Tool[] = [shellTool, filesTool, httpTool, claudeCodeTool, mcpTool, memoryTool, thinkTool, handoffTool, notifyTool, adapterTool, publishTool, systemTool]) {
    for (const t of tools) this.map.set(t.name, t);
  }
  get(name: string) {
    return this.map.get(name);
  }
  list() {
    return [...this.map.values()];
  }
  register(t: Tool) {
    this.map.set(t.name, t);
  }
  async statusAll(core: Core) {
    const out = [];
    for (const t of this.list()) {
      let s: { status: string; detail?: string };
      try {
        s = await t.status(core);
      } catch (e: any) {
        s = { status: 'unavailable', detail: String(e.message) };
      }
      out.push({ name: t.name, description: t.description, ...s });
    }
    return out;
  }
}
