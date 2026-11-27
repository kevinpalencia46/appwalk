// Planner: turns an objective into steps. Agents with a built-in playbook plan
// deterministically (cheap, reliable). Chat questions get a direct memory→answer plan.
// Everything else asks the `plan` model for a JSON step list, validated against the
// tool registry; if no model is reachable we fall back to the direct plan.
import type { Core } from '../core.js';
import type { TaskRow, StepPlan } from './store.js';
import type { AgentDef } from '../agents/agents.js';
import { NoModelError } from '../router/router.js';
import { log } from '../log.js';

export const PROJECTS: Record<string, RegExp> = {
  storefront: /\bstore ?front\b|\bshop\b|\borders?\b|\bcheckout/i,
  builder: /\bbuilder\b|\blanding page|\bsite\b|\bwebsite/i,
  showrunner: /\bshowrunner\b|\bvideo|\bscript\b|\brender/i,
  bge: /\bgrowth engine\b|\bbge\b|\bleads?\b|\bcrm\b|\boutreach\b|\bprospects?/i,
  meme: /\bmeme\b/i,
  trading: /\btrading\b|\bpaper trad/i,
  'appliance-pro-site': /\bappliance\b/i,
  ren2: /\bren ?2\b|\bren\b/i,
};

export function detectProject(text: string): string | null {
  for (const [p, re] of Object.entries(PROJECTS)) if (re.test(text)) return p;
  return null;
}

const QUESTION = /^(summari[sz]e|what|who|why|how|when|where|which|tell me|list|show|explain|remind|do we|did we|is there|are there)\b|\?\s*$/i;

export function directPlan(objective: string, project: string | null): StepPlan[] {
  return [
    { tool: 'memory', args: { action: 'search', query: objective, ...(project ? { project } : {}), limit: 8 }, note: 'Pull relevant memory' },
    {
      tool: 'think',
      args: {
        kind: 'chat',
        prompt: `Kevin asked: {{objective}}\n\nRelevant items from Ren's memory:\n{{step.0}}\n\nAnswer directly and briefly (phone-readable). Cite memory item ids like #12 when you use them. If memory has nothing relevant, say so plainly.`,
        fallback: 'extractive',
        material: '{{step.0}}',
      },
      note: 'Answer',
    },
  ];
}

export function parsePlanJson(text: string, toolNames: string[]): StepPlan[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('planner returned no JSON array');
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr) || !arr.length) throw new Error('empty plan');
  return arr.slice(0, 8).map((s: any, i: number) => {
    if (!s || typeof s.tool !== 'string' || !toolNames.includes(s.tool)) throw new Error(`step ${i}: unknown tool ${s?.tool}`);
    return { tool: s.tool, args: s.args && typeof s.args === 'object' ? s.args : {}, note: typeof s.note === 'string' ? s.note.slice(0, 120) : undefined };
  });
}

export async function planTask(core: Core, task: TaskRow, agent: AgentDef | null, signal: AbortSignal): Promise<StepPlan[]> {
  if (agent) {
    const p = core.agents.planFor(agent, task);
    if (p) return p;
  }
  const project = task.project;
  if (QUESTION.test(task.objective.trim()) || task.kind === 'chat-direct') return directPlan(task.objective, project);

  const ctx = core.memory.contextFor(task.objective, project);
  const tools = core.tools.list().filter((t) => !['handoff'].includes(t.name) || agent);
  const catalog = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  const prompt = `Objective: ${task.objective}
Project: ${project || 'unknown'}
${agent ? `Agent: ${agent.name} — ${agent.mission}\nPlaybook:\n${core.agents.playbook(agent.id).slice(0, 1200)}\n` : ''}
Relevant memory:
${ctx.text || '(none)'}

Tools:
${catalog}

Write a short plan (1–6 steps) as a JSON array of {"tool": name, "args": {...}, "note": "why"}.
Step outputs can be referenced in later args as {{step.N}} (0-based). The last step's output is the answer Kevin sees, so end with a "think" step that writes it.
Gated actions (spending money, publishing, contacting people, deleting outside workspace) will ask Kevin automatically — include them when needed, don't avoid them.
Return only the JSON array.`;
  try {
    const r = await core.router.complete({ kind: 'plan', prompt, agentId: task.agent_id, agentCap: agent?.daily_budget_usd, taskId: task.id, prefer: agent?.models?.plan, signal });
    return parsePlanJson(r.text, core.tools.list().map((t) => t.name));
  } catch (e: any) {
    if (signal.aborted) throw e;
    log('warn', `planner fell back to direct plan for task ${task.id}`, e instanceof NoModelError ? 'no plan model' : String(e.message).slice(0, 200));
    return directPlan(task.objective, project);
  }
}
