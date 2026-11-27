import { Tool, ToolError } from './types.js';
import { NoModelError, Kind } from '../router/router.js';
import { KINDS } from '../memory/memory.js';

export const memoryTool: Tool = {
  name: 'memory',
  description: 'Knowledge base. args: { action: search|add|get, query?, project?, kind?, title?, body?, id? }. Kinds: fact, decision, preference, playbook, lesson.',
  async status() {
    return { status: 'ok' };
  },
  async run(args, ctx) {
    const m = ctx.core.memory;
    const action = args.action || 'search';
    if (action === 'search') {
      const items = m.search(String(args.query || ctx.task.objective), { project: args.project || undefined, kind: args.kind || undefined, limit: Number(args.limit || 8) });
      if (!items.length) return { output: `No memory items match "${args.query || ctx.task.objective}"${args.project ? ` in ${args.project}` : ''}.`, data: { ids: [] } };
      return {
        output: items.map((i) => `[#${i.id} ${i.project}/${i.kind}] ${i.title}\n${i.body.replace(/^#\s+.*\n+/, '').slice(0, 700)}`).join('\n\n---\n\n'),
        data: { ids: items.map((i) => i.id) },
      };
    }
    if (action === 'get') {
      const it = m.get(Number(args.id));
      if (!it) throw new ToolError(`no memory item ${args.id}`);
      return { output: `${it.title}\n\n${it.body}` };
    }
    if (action === 'add') {
      if (!args.title || !args.body) throw new ToolError('memory add needs title and body');
      const kind = KINDS.includes(args.kind) ? args.kind : 'fact';
      const id = m.add({ project: args.project || ctx.task.project || 'general', kind, title: String(args.title), body: String(args.body), source: ctx.task.agent_id ? `agent:${ctx.task.agent_id}` : 'ren2' });
      return { output: `saved memory #${id}: ${args.title}`, data: { id } };
    }
    throw new ToolError(`unknown memory action ${action}`);
  },
};

/** Extractive fallback when no model is reachable — labelled, never dressed up as AI output. */
export function extractive(material: string, objective: string): string {
  const blocks = (material.includes('\n---\n') ? material.split(/\n\n---\n\n/) : material.split(/\n\n+/)).filter((b) => b.trim()).slice(0, 8);
  if (!blocks.length) return `No model is available and there was nothing to summarize for: ${objective}`;
  return `(No model available — showing the matching memory verbatim, not an AI summary.)\n\n${blocks.map((b) => '• ' + b.replace(/\n/g, '\n  ').slice(0, 500)).join('\n')}`;
}

export const thinkTool: Tool = {
  name: 'think',
  description: 'Ask a model. args: { kind: chat|plan|research|write|cheap-summarize, prompt, system?, fallback?: "extractive", material? }. Output = the model answer.',
  async status(core) {
    const s = await core.router.status();
    const ok = Object.values(s.providers).some((p) => p.status === 'ok');
    return ok ? { status: 'ok' } : { status: 'needs_credentials', detail: 'no model provider configured' };
  },
  async run(args, ctx) {
    if (!args.prompt) throw new ToolError('think needs args.prompt');
    const agent = ctx.agent;
    const kind = (args.kind || 'chat') as Kind;
    const prefer = agent?.models?.[kind === 'cheap-summarize' ? 'summarize' : kind === 'plan' ? 'plan' : 'work'];
    try {
      const r = await ctx.core.router.complete({
        kind,
        prompt: String(args.prompt),
        system: args.system ? String(args.system) : 'You are Ren, Kevin\'s operating assistant. Be concise, concrete and honest. Never invent numbers; say when data is missing or MOCK.',
        agentId: ctx.task.agent_id,
        agentCap: agent?.daily_budget_usd,
        taskId: ctx.task.id,
        prefer,
        maxTokens: args.max_tokens ? Number(args.max_tokens) : undefined,
        signal: ctx.signal,
      });
      return { output: r.text, data: { model: r.model, provider: r.provider, usd: r.usd } };
    } catch (e) {
      if (e instanceof NoModelError && args.fallback === 'extractive') {
        return { output: extractive(String(args.material ?? ''), ctx.task.objective), data: { model: null, reasons: e.reasons } };
      }
      throw e;
    }
  },
};

export const messageTool: Tool = {
  name: 'message',
  description: 'Talk to teammates. args: { to: agent id | "*" (whole team), kind: request|fyi, subject, body }. A request becomes work on their desk; its result comes back to you as a reply.',
  async status() {
    return { status: 'ok' };
  },
  async run(args, ctx) {
    const to = String(args.to || '');
    const kind = args.kind === 'request' ? 'request' : 'fyi';
    if (!to) throw new ToolError('message needs to');
    if (to !== '*' && !ctx.core.agents.get(to)) throw new ToolError(`no agent ${to}`);
    if (to === '*' && kind === 'request') throw new ToolError('requests go to one agent, not the whole team');
    if (!args.subject) throw new ToolError('message needs a subject');
    const from = ctx.task.agent_id || 'ren';
    const m = ctx.core.messages.send({ from, to, kind, subject: String(args.subject), body: String(args.body ?? ''), project: args.project || ctx.task.project, originTaskId: ctx.task.id, key: ctx.key });
    return { output: `${kind === 'request' ? 'asked' : 'told'} ${to === '*' ? 'the team' : to}: ${m.subject} (message #${m.id})`, data: { messageId: m.id } };
  },
};

/** handoff = a request message (kept for planner/back-compat). */
export const handoffTool: Tool = {
  name: 'handoff',
  description: 'Hand work to another agent. args: { agent, objective, project? }. Same as message kind=request.',
  async status() {
    return { status: 'ok' };
  },
  async run(args, ctx) {
    if (!args.agent || !args.objective) throw new ToolError('handoff needs agent and objective');
    const [subject, ...rest] = String(args.objective).split('\n');
    return messageTool.run({ to: args.agent, kind: 'request', subject, body: rest.join('\n').trim(), project: args.project }, ctx);
  },
};

export const notifyTool: Tool = {
  name: 'notify',
  description: 'Send Kevin a short Telegram note (not a decision). args: { text, link? }.',
  async status(core) {
    return core.telegram.configured() ? { status: 'ok' } : { status: 'needs_credentials', detail: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' };
  },
  async run(args, ctx) {
    if (!args.text) throw new ToolError('notify needs text');
    const sent = await ctx.core.telegram.notify(String(args.text) + (args.link ? `\n${args.link}` : ''));
    return { output: sent ? 'sent to Telegram' : 'Telegram not configured — note kept on the dashboard only', data: { sent } };
  },
};
