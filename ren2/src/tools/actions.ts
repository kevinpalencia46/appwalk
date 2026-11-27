// Tools that act on projects and on Ren 2 itself: adapter, publish, system.
import { Tool, ToolError } from './types.js';
import { health, healthText } from '../health.js';
import { today } from '../env.js';

/** Human-readable preview of an outreach batch for the Contact decision. */
export function messagesPreview(m: unknown): string {
  try {
    const arr = typeof m === 'string' ? JSON.parse(m.match(/\[[\s\S]*\]/)?.[0] || 'null') : m;
    if (!Array.isArray(arr)) throw new Error('not a list');
    return `${arr.length} message(s):\n\n` + arr.map((x: any, i: number) => `${i + 1}. To ${x.prospect_id ?? '?'} — ${x.subject ?? '(no subject)'}\n${x.body ?? ''}`).join('\n\n');
  } catch {
    return typeof m === 'string' ? m : JSON.stringify(m, null, 1);
  }
}

export const adapterTool: Tool = {
  name: 'adapter',
  description: 'Use a project adapter. args: { adapter: builder|storefront|showrunner|bge|meme|trading|oldren, method, ...methodArgs }. Gated methods ask Kevin automatically.',
  async status(core) {
    return { status: 'ok', detail: `${core.adapters.list().length} adapters (${core.settings.adapterMode})` };
  },
  async run(args, ctx) {
    const a = ctx.core.adapters.get(args.adapter);
    if (!a) throw new ToolError(`no adapter ${args.adapter}`);
    const spec = a.methods[args.method];
    if (!spec) throw new ToolError(`${a.id} has no method ${args.method} (has: ${Object.keys(a.methods).join(', ')})`);
    if (ctx.agent && !ctx.core.agents.canCall(ctx.agent, a.id, args.method, spec.kind)) {
      throw new ToolError(`${ctx.agent.id} has no access to ${a.name}.${args.method} — add it under access: ${a.id}: in agents/${ctx.agent.id}.yaml`);
    }
    const { adapter: _a, method: _m, optional: _o, result: _r, ...rest } = args;
    if (spec.gate) {
      const preview = rest.preview_url || (rest.messages ? messagesPreview(rest.messages) : JSON.stringify(rest, null, 1));
      ctx.gate({ gate: spec.gate.gate, actionType: spec.gate.actionType, summary: `${ctx.agent?.name || 'Ren'} wants to ${spec.description} (${a.name}${a.mode === 'mock' ? ', MOCK' : ''})`, preview: String(preview).slice(0, 3000) });
    }
    const r = await a.call(args.method, rest, { key: ctx.key, taskId: ctx.task.id, agentId: ctx.task.agent_id, signal: ctx.signal });
    return { output: r.text, data: r.data };
  },
};

export const publishTool: Tool = {
  name: 'publish',
  description: 'Social posts. args: { action: draft|publish, platform, text, draft_id? }. publish goes through the Publish gate.',
  async status(core) {
    const ok = Object.values(core.publishers).filter((p) => p.status().status === 'ok').map((p) => p.platform);
    return { status: 'ok', detail: `ready: ${ok.join(', ')}` };
  },
  async run(args, ctx) {
    const core = ctx.core;
    const platform = String(args.platform || 'drafts');
    const pub = core.publishers[platform];
    if (!pub) throw new ToolError(`unknown platform ${platform}`);
    if (args.action === 'draft') {
      const text = String(args.text || '').trim();
      if (!text) throw new ToolError('empty draft');
      const existing = core.drafts.byTask(ctx.task.id);
      const d = existing && existing.text === text ? existing : core.drafts.add({ platform, agentId: ctx.task.agent_id, taskId: ctx.task.id, project: args.project || ctx.task.project, text });
      return { output: `draft #${d.id} for ${pub.label}:\n${d.text}`, data: { id: d.id } };
    }
    if (args.action === 'publish') {
      const d = args.draft_id ? core.drafts.get(Number(args.draft_id)) : core.drafts.byTask(ctx.task.id);
      if (!d) throw new ToolError('no draft to publish');
      if (args.text && args.revision_note) core.drafts.set(d.id, { text: String(args.text) }); // Kevin's edit applied
      const cur = core.drafts.get(d.id)!;
      if (cur.status === 'published') return { output: `draft #${d.id} already published` };
      ctx.gate({ gate: 'publish', actionType: `post:${platform}`, summary: `${ctx.agent?.name || 'Ren'}: post to ${pub.label}`, preview: cur.text });
      const st = pub.status();
      if (st.status !== 'ok') throw new ToolError(`${pub.label}: ${st.status} — ${st.detail}`);
      const r = await pub.publish(cur);
      core.drafts.set(d.id, { status: r.posted ? 'published' : 'approved', external_id: r.externalId });
      return { output: r.text, data: { draftId: d.id, posted: r.posted } };
    }
    throw new ToolError(`unknown publish action ${args.action}`);
  },
};

export const systemTool: Tool = {
  name: 'system',
  description: 'Ren 2 self-checks. args: { action: health|adapters|queue|agent_stats|digest }.',
  async status() {
    return { status: 'ok' };
  },
  async run(args, ctx) {
    const core = ctx.core;
    switch (args.action) {
      case 'echo':
        return { output: String(args.text ?? '') };
      case 'health': {
        const h = health(core.settings.dataDir);
        for (const w of h.warnings) core.alert('warn', `Pi health: ${w}`, `health:${w.split(' ')[0]}`);
        return { output: healthText(h), data: h };
      }
      case 'adapters': {
        const rows = await core.adapters.statusAll();
        return { output: rows.map((r) => `${r.name}: ${r.state} — ${r.detail}`).join('\n'), data: rows };
      }
      case 'queue': {
        // Ren 2's own queue jams: tasks marked running/planning but not actually active.
        const stuck = core.db
          .prepare("SELECT id FROM tasks WHERE state IN ('running','planning','verifying') AND updated_at < ?")
          .all(new Date(Date.now() - 30 * 60_000).toISOString()) as { id: number }[];
        const cleared = stuck.filter((s) => !core.runner.active.has(s.id)).map((s) => (core.tasks.requeue(s.id), s.id));
        const c = core.tasks.counts();
        return { output: `queue: ${c.queued} queued, ${c.running} running, ${c.needs_decision} waiting on Kevin, ${c.failed} failed${cleared.length ? ` · requeued jammed tasks ${cleared.map((i) => '#' + i).join(', ')}` : ' · no jams'}`, data: { counts: c, cleared } };
      }
      case 'ops_report': {
        const warn = /⚠|unreachable|failed [1-9]/.test(`${args.health}\n${args.queue}`);
        return { output: `Ops check ${new Date().toLocaleString()}\n\n${args.health}\n\nAdapters:\n${args.adapters}\n\n${args.queue}${warn ? '\n\nNeeds a look — see warnings above.' : ''}` };
      }
      case 'agent_stats': {
        const s = core.agentStats(String(args.agent), Number(args.days || 7));
        return { output: s.text, data: s };
      }
      case 'apply_playbook': {
        const text = String(args.text || '');
        if (!text.trim() || text.startsWith('(optional step failed')) return { output: `No model available for the retro — playbook unchanged. ${text.slice(0, 200)}` };
        const m = text.match(/^\s*REASON:\s*(.+)$/im);
        const reason = m?.[1]?.trim() || 'weekly retro';
        const body = text.replace(/^\s*REASON:.*$/im, '').trim();
        if (/^no change/i.test(reason) || body === core.agents.playbook(String(args.agent)).trim()) return { output: `Retro: playbook unchanged (${reason}).` };
        const v = core.agents.applyPlaybook(String(args.agent), body, reason);
        return { output: `Playbook v${v} applied for ${args.agent}: ${reason}\n\n${body}`, data: { version: v } };
      }
      case 'digest':
        return { output: core.digestText(today()) };
      default:
        throw new ToolError(`unknown system action ${args.action}`);
    }
  },
};
