// files: read/write inside workspace/ and Ren 2's own repo. Reads also allowed under
// config/read_paths.yaml. Writing or deleting anywhere else hits the Destroy gate.
import fs from 'node:fs';
import path from 'node:path';
import { Tool, ToolError } from './types.js';
import { ROOT } from '../env.js';
import { readYaml } from '../yaml.js';
import type { Core } from '../core.js';

export function within(p: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function writeRoots(core: Core): string[] {
  return [core.settings.workspace, ROOT];
}
export function readRoots(core: Core): string[] {
  const extra = readYaml<{ read: string[] }>(path.join(core.settings.configDir, 'read_paths.yaml'), { read: [] }).read || [];
  return [...writeRoots(core), ...extra.map((p) => path.resolve(p.replace(/^~(?=\/)/, process.env.HOME || '~')))];
}

function resolve(core: Core, p: string): string {
  if (!p) throw new ToolError('files needs args.path');
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(core.settings.workspace, p);
}

const MAX_READ = 200 * 1024;

export const filesTool: Tool = {
  name: 'files',
  description: 'Files. args: { action: read|write|list|delete, path, content? }. Relative paths are inside workspace/.',
  async status() {
    return { status: 'ok' };
  },
  async run(args, ctx) {
    const core = ctx.core;
    const p = resolve(core, args.path);
    const action = args.action || 'read';
    const inWrite = writeRoots(core).some((r) => within(p, r));
    if (action === 'read' || action === 'list') {
      if (!readRoots(core).some((r) => within(p, r))) throw new ToolError(`not allowed to read ${p} (add it to config/read_paths.yaml)`);
      if (!fs.existsSync(p)) throw new ToolError(`${p} does not exist`);
      if (action === 'list' || fs.statSync(p).isDirectory()) {
        const entries = fs.readdirSync(p, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name));
        return { output: entries.join('\n'), data: { entries } };
      }
      const buf = fs.readFileSync(p);
      return { output: buf.subarray(0, MAX_READ).toString('utf8') + (buf.length > MAX_READ ? '\n…[truncated]' : '') };
    }
    if (action === 'write' || action === 'delete') {
      if (path.basename(p) === '.env') throw new ToolError('Ren 2 never writes .env');
      const exists = fs.existsSync(p);
      if (!inWrite && (exists || action === 'delete')) {
        ctx.gate({ gate: 'destroy', actionType: `${action}:outside`, summary: `${action === 'delete' ? 'Delete' : 'Overwrite'} ${p}`, preview: action === 'write' ? String(args.content ?? '').slice(0, 1500) : undefined });
      } else if (!inWrite) {
        throw new ToolError(`writes are limited to workspace/ and Ren 2's repo (asked for ${p})`);
      }
      if (action === 'delete') {
        if (exists) fs.rmSync(p, { recursive: true, force: true });
        return { output: `deleted ${p}` };
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(args.content ?? ''));
      return { output: `wrote ${Buffer.byteLength(String(args.content ?? ''))} bytes to ${path.relative(core.settings.workspace, p) || p}` };
    }
    throw new ToolError(`unknown files action ${action}`);
  },
};
