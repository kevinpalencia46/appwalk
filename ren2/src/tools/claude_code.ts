// claude_code: headless Claude Code in a git worktree. Result = a branch + summary +
// test output. Only repos inside workspace/ or Ren 2's own repo — never side projects.
import fs from 'node:fs';
import path from 'node:path';
import { Tool, ToolError } from './types.js';
import { heavy } from './limits.js';
import { runShell } from './shell.js';
import { runClaudeCli, parseClaudeCli, whichBin } from '../router/providers.js';
import { ROOT } from '../env.js';
import { within } from './files.js';

async function git(cwd: string, cmd: string) {
  const r = await runShell(`git ${cmd}`, { cwd, timeoutMs: 60_000 });
  if (r.code !== 0) throw new ToolError(`git ${cmd.split(' ')[0]} failed: ${r.out.slice(0, 500)}`);
  return r.out.trim();
}

export const claudeCodeTool: Tool = {
  name: 'claude_code',
  description: 'Coding task via headless Claude Code in a git worktree. args: { prompt, repo? (path in workspace/ or Ren 2 repo), test? (command) }. Returns a branch.',
  heavy: true,
  async status() {
    return whichBin(process.env.CLAUDE_BIN || 'claude') ? { status: 'ok' } : { status: 'unavailable', detail: 'claude CLI not on PATH' };
  },
  async run(args, ctx) {
    if (!args.prompt) throw new ToolError('claude_code needs args.prompt');
    const ws = ctx.core.settings.workspace;
    const repoArg = args.repo ? path.resolve(ws, args.repo) : ROOT;
    if (!within(repoArg, ws) && !within(repoArg, ROOT)) throw new ToolError(`claude_code only works on repos in workspace/ or Ren 2's own repo`);
    const top = await git(repoArg, 'rev-parse --show-toplevel');
    const branch = `ren2/task-${ctx.task.id}-${ctx.stepIdx}`;
    const wt = path.join(ws, 'worktrees', branch.replace(/\//g, '_'));
    const release = await heavy.acquire(ctx.signal);
    try {
      if (!fs.existsSync(wt)) {
        fs.mkdirSync(path.dirname(wt), { recursive: true });
        const exists = (await runShell(`git rev-parse --verify --quiet ${branch}`, { cwd: top, timeoutMs: 10_000 })).code === 0;
        await git(top, exists ? `worktree add ${JSON.stringify(wt)} ${branch}` : `worktree add -b ${branch} ${JSON.stringify(wt)}`);
      }
      const sub = path.relative(top, repoArg);
      const cwd = sub ? path.join(wt, sub) : wt;
      const out = await runClaudeCli(
        ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read Edit Write Glob Grep Bash(npm test:*) Bash(npm run:*) Bash(node:*) Bash(git status:*) Bash(git diff:*)'],
        { cwd, signal: ctx.signal, timeoutMs: 20 * 60_000, input: String(args.prompt) },
      );
      const res = parseClaudeCli(out);
      ctx.core.budget.record({ provider: 'claude_code', model: 'claude-cli', kind: 'code', agentId: ctx.task.agent_id, taskId: ctx.task.id, usd: res.reportedUsd ?? 0, tokens: res.inTokens + res.outTokens, cloud: true });
      let tests = '';
      if (args.test) {
        const t = await runShell(String(args.test), { cwd, timeoutMs: 15 * 60_000, signal: ctx.signal });
        tests = `\n\nTests (${args.test}) exit ${t.code}:\n${t.out.slice(-3000)}`;
      }
      await runShell(`git add -A && git -c user.name=ren2 -c user.email=ren2@localhost commit -q -m ${JSON.stringify(`ren2 task ${ctx.task.id}: ${ctx.task.objective.slice(0, 60)}`)}`, { cwd: wt, timeoutMs: 30_000 });
      const stat = (await runShell(`git diff --stat HEAD~1 2>/dev/null | tail -20`, { cwd: wt, timeoutMs: 10_000 })).out;
      return { output: `Branch: ${branch}\nWorktree: ${wt}\n\n${res.text.slice(0, 4000)}\n\n${stat}${tests}`, data: { branch, worktree: wt } };
    } finally {
      release();
    }
  },
};
