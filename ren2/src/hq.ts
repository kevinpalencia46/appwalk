// Ren's headquarters: sectors + scoreboard, the report Ren plans from, plans (what Ren
// delegated to whom), site reviews with Kevin, and the deterministic watchers (Worklane
// sign-ups first, BC area rotation). Ren's model-written plan is optional: without a model
// Ren still runs a rule-based plan so the team keeps moving.
import path from 'node:path';
import type { Core } from './core.js';
import { readYaml } from './yaml.js';
import { kvGet, kvSet } from './db.js';
import { nowIso, today } from './env.js';
import { emit } from './log.js';

export interface Goal {
  id: string;
  text: string;
  metric?: string;
  target?: number;
}
export interface Sector {
  id: string;
  name: string;
  why: string;
  agents: string[];
  goals: Goal[];
  niches?: string[];
  channels?: string[];
  areas?: string[];
  properties?: string[];
  milestones?: { platform: string; text: string }[];
}

export function loadSectors(configDir: string): Sector[] {
  const raw = readYaml<{ sectors: Record<string, any> }>(path.join(configDir, 'sectors.yaml'), { sectors: {} }).sectors || {};
  return Object.entries(raw).map(([id, s]) => ({ id, name: s.name || id, why: s.why || '', agents: s.agents || [], goals: s.goals || [], niches: s.niches || [], channels: s.channels || [], areas: s.areas || [], properties: s.properties, milestones: s.milestones || [] }));
}

const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

export interface MetricValue {
  value: number | null;
  mock: boolean;
  note?: string;
}

/** Numbers for the scoreboard. Ren 2's own counts are real; adapter numbers are MOCK until live. */
export async function metric(core: Core, name: string): Promise<MetricValue> {
  const db = core.db;
  const n = (sql: string, ...a: any[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);
  const stepCount = (method: string, days: number) =>
    n("SELECT COUNT(*) n FROM steps WHERE status = 'done' AND tool = 'adapter' AND json_extract(args, '$.method') = ? AND finished_at >= ?", method, since(days));
  const mock = core.settings.adapterMode === 'mock';
  try {
    switch (name) {
      case 'videos_made_7d':
        return { value: stepCount('queue_job', 7), mock: false, note: 'videos queued in Showrunner by Media' };
      case 'followers_total': {
        const r = await core.adapters.get('showrunner')!.call('channels', {}, { key: 'hq', taskId: 0, agentId: null });
        return { value: (r.data?.channels || []).reduce((s: number, c: any) => s + Number(c.followers || 0), 0), mock: r.mock };
      }
      case 'analytics_reviews_7d':
        return { value: n("SELECT COUNT(*) n FROM tasks WHERE agent_id = 'media' AND job_id = 'analytics-review' AND state = 'done' AND finished_at >= ?", since(7)), mock: false };
      case 'open_signup_requests':
        return { value: n("SELECT COUNT(*) n FROM messages WHERE to_agent = 'sites' AND priority > 0 AND status IN ('unread','in_progress')"), mock: false };
      case 'sweeps_7d':
        return { value: stepCount('sweep', 7), mock: false };
      case 'demos_built_7d':
        return { value: stepCount('create_site', 7), mock: false };
      case 'open_reviews':
        return { value: n("SELECT COUNT(*) n FROM reviews WHERE status = 'pending'"), mock: false };
      case 'web_skills':
        return { value: core.skills.list().filter((s) => s.projects.includes('builder')).length, mock: false };
      case 'property_reviews_7d':
        return { value: n("SELECT COUNT(*) n FROM tasks WHERE agent_id = 'analyst' AND state = 'done' AND finished_at >= ?", since(7)), mock: false };
      case 'conversions_30d': {
        const sf = core.adapters.get('storefront')!;
        let total = 0;
        let anyMock = false;
        for (const p of propertyIds(core)) {
          const r = await sf.call('summary', { property: p }, { key: 'hq', taskId: 0, agentId: null }).catch(() => null);
          if (r) (total += Number(r.data?.conversions_30d || 0)), (anyMock ||= r.mock);
        }
        return { value: total, mock: anyMock, note: 'sign-ups + sales + orders across live properties' };
      }
      case 'planned_properties': {
        const r = await core.adapters.get('storefront')!.call('properties', {}, { key: 'hq', taskId: 0, agentId: null });
        return { value: (r.data?.properties || []).filter((p: any) => p.status === 'planned').length, mock: r.mock };
      }
      case 'open_alerts':
        return { value: n('SELECT COUNT(*) n FROM alerts WHERE dismissed = 0'), mock: false };
      case 'spend_today':
        return { value: Math.round(core.budget.spent() * 100) / 100, mock: false, note: `of $${core.budget.cap().toFixed(2)}` };
      default:
        return { value: null, mock, note: 'unknown metric' };
    }
  } catch (e: any) {
    return { value: null, mock, note: String(e.message).slice(0, 120) };
  }
}

export function propertyIds(core: Core): string[] {
  const s = core.sectors.find((x) => x.id === 'storefronts');
  return s?.properties?.length ? s.properties : ['worklane', 'book', 'shop'];
}

export async function scoreboard(core: Core) {
  const out = [];
  for (const s of core.sectors) {
    const goals = [];
    for (const g of s.goals) {
      const m = g.metric ? await metric(core, g.metric) : null;
      const met = m && g.target !== undefined && m.value !== null ? (g.metric?.startsWith('open_') ? m.value <= g.target : m.value >= g.target) : null;
      goals.push({ ...g, value: m?.value ?? null, mock: m?.mock ?? false, note: m?.note, met });
    }
    const desks = s.agents.filter((a) => core.agents.get(a)).map((a) => {
      const d = core.desk(a);
      return { id: a, name: d.name, status: d.status, working: Boolean(d.now), waiting: d.counts.waiting, needsYou: d.waitingOnKevin.length };
    });
    out.push({ id: s.id, name: s.name, why: s.why, goals, desks, niches: s.niches, channels: s.channels, milestones: s.milestones, areas: s.areas });
  }
  return out;
}

/** Everything Ren needs to plan, as compact text + data. */
export async function hqReport(core: Core) {
  const board = await scoreboard(core);
  const desks = core.agents.list().filter((a) => a.id !== 'ren').map((a) => core.desk(a.id));
  const cands = await core.adapters.get('builder')!.call('candidates', { min_score: 7 }, { key: 'hq', taskId: 0, agentId: null }).catch(() => null);
  const built = new Set(
    (core.db.prepare("SELECT json_extract(args, '$.candidate_id') c FROM steps WHERE tool = 'adapter' AND json_extract(args, '$.method') = 'create_site' AND status = 'done'").all() as { c: string | null }[]).map((r) => r.c).filter(Boolean),
  );
  const asked = new Set((core.db.prepare("SELECT subject FROM messages WHERE to_agent = 'sites' AND kind = 'request'").all() as { subject: string }[]).map((r) => r.subject));
  const unbuilt = (cands?.data?.candidates || []).filter((c: any) => !built.has(c.id) && ![...asked].some((s) => s.includes(c.id)));
  const reviews = openReviews(core);
  const decisions = core.gate.open();
  const b = core.budget.summary();
  const team = core.messages.board(10);
  const lines: string[] = [`Ren HQ report — ${new Date().toLocaleString()} (adapters ${core.settings.adapterMode.toUpperCase()}${core.settings.adapterMode === 'mock' ? ': numbers are fixtures, treat as practice' : ''})`];
  for (const s of board) {
    lines.push(`\n## ${s.name} — ${s.why}`);
    for (const g of s.goals) lines.push(`- ${g.text}: ${g.value ?? 'n/a'}${g.target !== undefined ? ` / target ${g.target}` : ''}${g.mock ? ' (MOCK)' : ''}${g.met === true ? ' ✓' : g.met === false ? ' ✗' : ''}`);
    if (s.niches !== undefined && s.id === 'media') lines.push(`- Niches: ${s.niches?.length ? s.niches.join(', ') : 'NOT SET — ask Kevin'}`);
    lines.push(`- Desks: ${s.desks.map((d) => `${d.id} ${d.working ? 'working' : d.status === 'running' ? 'idle' : d.status}${d.waiting ? `, ${d.waiting} in inbox` : ''}${d.needsYou ? `, ${d.needsYou} waiting on Kevin` : ''}`).join('; ') || 'none'}`);
  }
  lines.push(`\n## Unbuilt candidates (score ≥ 7)\n${unbuilt.length ? unbuilt.slice(0, 8).map((c: any) => `- ${c.id} ${c.business} (${c.niche}, ${c.area}) ${c.score}/10: ${c.reason}`).join('\n') : '- none — Scout should sweep'}`);
  lines.push(`\n## Open site reviews: ${reviews.length}${reviews.length ? ' — ' + reviews.map((r) => r.title).join(', ') : ''}`);
  lines.push(`## Decisions waiting on Kevin: ${decisions.length}`);
  lines.push(`## Budget: $${b.spent.toFixed(2)} of $${b.cap.toFixed(2)} today. Per-agent caps: ${core.agents.list().map((a) => `${a.id} $${core.agents.capFor(a.id).toFixed(2)}`).join(', ')}`);
  lines.push(`\n## Team channel (latest)\n${team.map((m) => `- ${m.from_agent} → ${m.to_agent} [${m.kind}${m.kind === 'request' ? ', ' + m.status : ''}] ${m.subject}`).join('\n') || '- quiet'}`);
  return { text: lines.join('\n'), board, desks: desks.map((d) => ({ id: d.id, status: d.status, working: Boolean(d.now), waiting: d.counts.waiting })), unbuilt, reviews: reviews.length, decisions: decisions.length };
}

// ── plans ──
export interface PlanItem {
  sector: string;
  agent: string;
  ask: string;
  why?: string;
  priority?: 'high' | 'normal';
  when?: 'now' | 'idle';
  message_id?: number;
}
export interface PlanRow {
  id: number;
  kind: string;
  headline: string;
  items: PlanItem[];
  questions: { q: string; answer?: string }[];
  notes: string | null;
  source: string;
  task_id: number | null;
  created_at: string;
}

export function latestPlan(core: Core): PlanRow | null {
  const r = core.db.prepare('SELECT * FROM plans ORDER BY id DESC LIMIT 1').get() as any;
  if (!r) return null;
  return { ...r, items: JSON.parse(r.items), questions: JSON.parse(r.questions) };
}

export function parsePlan(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('plan has no JSON object');
  return JSON.parse(m[0]);
}

/** Rule-based plan when no model is available — keeps the team moving honestly. */
export function defaultPlan(core: Core, report: Awaited<ReturnType<typeof hqReport>>): any {
  const items: PlanItem[] = [];
  const busy = (id: string) => report.desks.find((d) => d.id === id)?.working || (report.desks.find((d) => d.id === id)?.waiting ?? 0) > 0;
  if (core.agents.get('scout') && !busy('scout')) items.push({ sector: 'websites', agent: 'scout', ask: `Sweep ${nextArea(core, false)} for businesses with no or outdated websites`, why: 'keep the candidate list full' });
  const top = report.unbuilt[0];
  if (top && core.agents.get('sites')) items.push({ sector: 'websites', agent: 'sites', ask: `Build demo for ${top.id}: ${top.business} (${top.niche}, ${top.area})`, why: `highest-rated unbuilt candidate (${top.score}/10). Niche: ${top.niche}`, when: 'idle' });
  if (core.agents.get('media') && !busy('media')) items.push({ sector: 'media', agent: 'media', ask: "Make today's video batch for our niches", why: 'post consistently' });
  return { headline: 'Rule-based plan (no planning model available): keep every sector moving.', items, questions: [], budget: [], pause: [], resume: [] };
}

/** Turn a plan (model JSON or rule-based) into delegated requests, budget moves, pauses. */
export function applyPlan(core: Core, plan: any, o: { kind: string; source: string; taskId: number | null; keyPrefix: string }): PlanRow {
  const items: PlanItem[] = [];
  const notes: string[] = [];
  for (const [i, it] of (Array.isArray(plan.items) ? plan.items : plan.priorities || []).slice(0, 8).entries()) {
    const agent = String(it.agent || '');
    if (!core.agents.get(agent) || agent === 'ren') {
      notes.push(`skipped item for unknown agent "${agent}"`);
      continue;
    }
    const m = core.messages.send({
      from: 'ren',
      to: agent,
      kind: 'request',
      subject: String(it.ask || '').slice(0, 280) || 'Work on your sector goals',
      body: it.why ? `Why: ${it.why}` : '',
      project: it.sector || null,
      priority: it.priority === 'high' ? 1 : 0,
      idleOnly: it.when === 'idle',
      originTaskId: o.taskId,
      key: `${o.keyPrefix}:item:${i}`,
    });
    items.push({ sector: String(it.sector || ''), agent, ask: m.subject, why: it.why, priority: it.priority === 'high' ? 'high' : 'normal', when: it.when === 'idle' ? 'idle' : 'now', message_id: m.id });
  }
  // Budget moves: per-agent caps for today, never above the global daily cap in total.
  const moves = Array.isArray(plan.budget) ? plan.budget : [];
  const proposed: Record<string, number> = {};
  for (const b of moves) if (core.agents.get(b.agent) && Number(b.usd) >= 0) proposed[b.agent] = Number(b.usd);
  if (Object.keys(proposed).length) {
    // A move may shift money between agents; it may not grow the total beyond today's cap.
    const before = core.agents.list().reduce((s, a) => s + core.agents.capFor(a.id), 0);
    const total = core.agents.list().reduce((s, a) => s + (proposed[a.id] ?? core.agents.capFor(a.id)), 0);
    if (total <= Math.max(before, core.budget.cap()) + 1e-9) {
      for (const [a, v] of Object.entries(proposed)) core.agents.setCapToday(a, v);
      notes.push(`budget today: ${Object.entries(proposed).map(([a, v]) => `${a} $${v.toFixed(2)}`).join(', ')}`);
    } else notes.push(`budget move refused: agent caps would grow to $${total.toFixed(2)} (from $${before.toFixed(2)}); moves can only shift money, not add it`);
  }
  for (const id of Array.isArray(plan.pause) ? plan.pause : []) if (core.agents.get(id) && id !== 'ren' && id !== 'ops') (core.agents.setStatus(id, 'paused'), notes.push(`paused ${id}`));
  for (const id of Array.isArray(plan.resume) ? plan.resume : []) if (core.agents.get(id)) (core.agents.setStatus(id, 'running'), notes.push(`resumed ${id}`));
  const proposals = (Array.isArray(plan.propose_agents) ? plan.propose_agents : []).map((p: any) => `Ren proposes a new agent "${p.id}": ${p.mission} — ${p.why}. Create it?`);
  const questions = [...(Array.isArray(plan.questions) ? plan.questions : []).map(String), ...proposals].slice(0, 6).map((q) => ({ q }));
  const r = core.db
    .prepare('INSERT INTO plans (kind, headline, items, questions, notes, source, task_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(o.kind, String(plan.headline || plan.summary || 'Plan').slice(0, 500), JSON.stringify(items), JSON.stringify(questions), notes.join('\n') || null, o.source, o.taskId, nowIso());
  const row = latestPlan(core)!;
  emit('plan', { id: Number(r.lastInsertRowid) });
  return row;
}

export function answerQuestion(core: Core, planId: number, idx: number, answer: string): PlanRow {
  const r = core.db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) as any;
  if (!r) throw new Error(`no plan ${planId}`);
  const qs = JSON.parse(r.questions);
  if (!qs[idx]) throw new Error(`no question ${idx}`);
  qs[idx].answer = answer;
  core.db.prepare('UPDATE plans SET questions = ? WHERE id = ?').run(JSON.stringify(qs), planId);
  core.memory.add({ project: 'ren', kind: 'preference', title: `Kevin: ${qs[idx].q.slice(0, 120)}`, body: `Q: ${qs[idx].q}\nA: ${answer}`, source: 'kevin' });
  core.messages.send({ from: 'kevin', to: 'ren', kind: 'fyi', subject: `Answer: ${qs[idx].q.slice(0, 120)}`, body: answer });
  emit('plan', { id: planId });
  return { ...r, items: JSON.parse(r.items), questions: qs };
}

// ── deterministic watchers ──
/** Worklane demo sign-ups go straight to Sites at high priority (once per sign-up). */
export async function watchSignups(core: Core, originTaskId: number | null): Promise<string> {
  const r = await core.adapters.get('storefront')!.call('signups', {}, { key: 'hq', taskId: 0, agentId: 'ren' });
  const sent: string[] = [];
  for (const s of r.data?.signups || []) {
    if (core.db.prepare('SELECT 1 FROM messages WHERE key = ?').get(`signup:${s.id}`)) continue;
    core.messages.send({
      from: 'ren',
      to: 'sites',
      kind: 'request',
      priority: 1,
      subject: `Worklane demo for sign-up ${s.id}: ${s.business} (${s.niche}, ${s.city})`,
      body: `They asked: ${s.wants}. This comes before any other build.\nNiche: ${s.niche}\nCity: ${s.city}`,
      project: 'websites',
      originTaskId,
      key: `signup:${s.id}`,
    });
    sent.push(s.id);
  }
  return sent.length ? `New Worklane sign-ups sent to Sites first: ${sent.join(', ')}${r.mock ? ' (MOCK)' : ''}` : `No new Worklane sign-ups${r.mock ? ' (MOCK)' : ''}.`;
}

/** Next BC area in the rotation (advances when `advance`). */
export function nextArea(core: Core, advance = true): string {
  const areas = core.sectors.find((s) => s.id === 'websites')?.areas || [];
  if (!areas.length) return 'Kamloops';
  const i = Number(kvGet(core.db, 'scout.area_idx') || 0) % areas.length;
  if (advance) kvSet(core.db, 'scout.area_idx', String(i + 1));
  return areas[i];
}

// ── site reviews (Ren + Kevin) ──
export interface ReviewRow {
  id: number;
  site_id: string;
  title: string;
  niche: string | null;
  candidate_id: string | null;
  preview_url: string | null;
  ren_notes: string | null;
  kevin_good: string | null;
  kevin_change: string | null;
  kevin_add: string | null;
  verdict: string | null;
  status: string;
  task_id: number | null;
  created_at: string;
  resolved_at: string | null;
}

export function openReviews(core: Core): ReviewRow[] {
  return core.db.prepare("SELECT * FROM reviews WHERE status = 'pending' ORDER BY id").all() as unknown as ReviewRow[];
}

export function openReview(core: Core, r: { site_id: string; title: string; niche?: string | null; candidate_id?: string | null; preview_url?: string | null; ren_notes: string; task_id?: number | null }): ReviewRow {
  const prev = core.db.prepare("SELECT * FROM reviews WHERE site_id = ? AND status = 'pending'").get(r.site_id) as ReviewRow | undefined;
  if (prev) return prev;
  const res = core.db
    .prepare('INSERT INTO reviews (site_id, title, niche, candidate_id, preview_url, ren_notes, status, task_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(r.site_id, r.title, r.niche ?? null, r.candidate_id ?? null, r.preview_url ?? null, r.ren_notes, 'pending', r.task_id ?? null, nowIso());
  const row = core.db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(res.lastInsertRowid)) as unknown as ReviewRow;
  emit('review', row);
  return row;
}

/**
 * Kevin's verdict. Everything becomes memory (our decisions), Ren turns it into skills,
 * and the site either goes back to Sites for changes or on to Outreach.
 */
export function resolveReview(core: Core, id: number, v: { verdict: 'approve' | 'changes'; good?: string; change?: string; add?: string }): ReviewRow {
  const r = core.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as ReviewRow | undefined;
  if (!r) throw new Error(`no review ${id}`);
  if (r.status !== 'pending') throw new Error(`review ${id} is already ${r.status}`);
  if (v.verdict === 'changes' && !(v.change || v.add)) throw new Error('say what should change or be added');
  core.db
    .prepare('UPDATE reviews SET kevin_good = ?, kevin_change = ?, kevin_add = ?, verdict = ?, status = ?, resolved_at = ? WHERE id = ?')
    .run(v.good ?? null, v.change ?? null, v.add ?? null, v.verdict, v.verdict === 'approve' ? 'approved' : 'changes_requested', nowIso(), id);
  const body = `Site: ${r.title}${r.niche ? ` (niche: ${r.niche})` : ''}\nVerdict: ${v.verdict === 'approve' ? 'approved' : 'needs changes'}\n\nRen's review:\n${r.ren_notes || '-'}\n\nKevin — good: ${v.good || '-'}\nKevin — change: ${v.change || '-'}\nKevin — add/improve: ${v.add || '-'}`;
  core.memory.add({ project: 'builder', kind: 'decision', title: `Site review: ${r.title}${r.niche ? ` (${r.niche})` : ''} — ${v.verdict === 'approve' ? 'approved' : 'changes'}`, body, source: 'review' });
  if (v.verdict === 'changes') {
    core.messages.send({ from: 'ren', to: 'sites', kind: 'request', priority: 1, project: 'websites', subject: `Revise demo ${r.site_id}: ${r.title}`, body: `Kevin and Ren reviewed it.\nKeep: ${v.good || '-'}\nChange: ${v.change || '-'}\nAdd/improve: ${v.add || '-'}\nNiche: ${r.niche || '-'}${r.candidate_id ? `\nCandidate: ${r.candidate_id}` : ''}`, key: `review:${id}:revise` });
  } else if (r.candidate_id && core.agents.get('outreach')) {
    core.messages.send({ from: 'ren', to: 'outreach', kind: 'request', project: 'websites', subject: `Reach out to ${r.candidate_id} with their demo: ${r.title}`, body: `Demo: ${r.preview_url}\nNiche: ${r.niche || '-'}\nWhat Kevin liked: ${v.good || '-'}`, key: `review:${id}:outreach` });
  }
  core.messages.send({ from: 'kevin', to: 'ren', kind: 'request', project: 'websites', subject: `Update web skills from review #${id}: ${r.title}`, body, key: `review:${id}:skills` });
  core.workLoop();
  const out = core.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as unknown as ReviewRow;
  emit('review', out);
  return out;
}

export function todayKey(): string {
  return today();
}
