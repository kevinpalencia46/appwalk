import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Tool, ToolError } from './types.js';
import { heavy, light } from './limits.js';
import { redact } from '../log.js';

const CAP = 64 * 1024;

export function runShell(cmd: string, o: { cwd: string; timeoutMs: number; signal?: AbortSignal }): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    // Never hand Ren's own secrets to arbitrary commands.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(KEY|TOKEN|SECRET|PASSWORD)$/i.test(k)));
    const child = spawn('bash', ['-c', cmd], { cwd: o.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let truncated = false;
    const add = (c: Buffer) => {
      if (out.length >= CAP) return void (truncated = true);
      out += c.toString();
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    let timedOut = false;
    const kill = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* gone */
      }
    };
    const t = setTimeout(() => ((timedOut = true), kill()), o.timeoutMs);
    o.signal?.addEventListener('abort', kill, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(t);
      o.signal?.removeEventListener('abort', kill);
      resolve({ code, out: redact(out.slice(0, CAP)) + (truncated ? '\n…[output truncated]' : ''), timedOut });
    });
  });
}

export const shellTool: Tool = {
  name: 'shell',
  description: 'Run a bash command inside workspace/. args: { cmd, timeout_s?, heavy? }. Use for builds, scripts, data wrangling.',
  async status(core) {
    return fs.existsSync(core.settings.workspace) ? { status: 'ok' } : { status: 'needs_config', detail: 'workspace/ missing' };
  },
  async run(args, ctx) {
    if (!args.cmd || typeof args.cmd !== 'string') throw new ToolError('shell needs args.cmd');
    const sem = args.heavy ? heavy : light;
    const release = await sem.acquire(ctx.signal);
    try {
      const r = await runShell(args.cmd, { cwd: ctx.core.settings.workspace, timeoutMs: Math.min(Number(args.timeout_s || 120), 1800) * 1000, signal: ctx.signal });
      if (ctx.signal.aborted) throw new Error('aborted');
      const head = r.timedOut ? `[timed out]\n` : '';
      if (r.code !== 0 && !args.allow_fail) throw new ToolError(`${head}exit ${r.code}\n${r.out.slice(-4000)}`);
      return { output: head + (r.out || `(exit ${r.code}, no output)`), data: { code: r.code } };
    } finally {
      release();
    }
  },
};
