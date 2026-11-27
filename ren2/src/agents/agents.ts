// Agents are config files: agents/<id>.yaml. State (running/paused/stopped, last run)
// lives in SQLite. Built-in agents (ops, research, content, sites, outreach) plan
// deterministically from their playbook steps below; agents Kevin creates from the
// dashboard are planned by the model from their mission.
import fs from 'node:fs';
import path from 'node:path';
import { DB } from '../db.js';
import { nowIso, today } from '../env.js';
import { readYaml, setYamlKey, YAML } from '../yaml.js';
import { emit, log } from '../log.js';
import { cronMatches, slotKey, validCron } from './cron.js';
import type { TaskRow, StepPlan } from '../tasks/store.js';
import type { Tasks } from '../tasks/store.js';

export interface AgentDef {
  id: string;
  name: string;
  mission: string;
  projects: string[];
  tools: string[];
  models: { plan?: string; work?: string; summarize?: string };
  schedule?: string;
  daily_budget_usd: number;
  reports_to: 'telegram_digest' | 'telegram_now';
  auto: string[];
  sources?: string[]; // research: public URLs to scan (competitors etc.)
  platform?: string; // content: default publishing platform
  default_objective?: string;
  playbook?: string; // initial playbook (v1)
  file: string;
}

export type AgentStatus = 'running' | 'paused' | 'stopped';

export function validateAgent(raw: any): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== 'object') return ['not a YAML mapping'];
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(raw.id || '')) errs.push('id must be lowercase letters/digits/dashes');
  if (!raw.name) errs.push('name is required');
  if (!raw.mission) errs.push('mission is required');
  if (raw.schedule && !validCron(String(raw.schedule))) errs.push(`schedule "${raw.schedule}" is not a valid 5-field cron`);
  if (raw.daily_budget_usd !== undefined && !(Number(raw.daily_budget_usd) >= 0)) errs.push('daily_budget_usd must be a number ≥ 0');
  if (raw.reports_to && !['telegram_digest', 'telegram_now'].includes(raw.reports_to)) errs.push('reports_to must be telegram_digest or telegram_now');
  return errs;
}

function normalize(raw: any, file: string): AgentDef {
  return {
    id: raw.id,
    name: raw.name,
    mission: raw.mission,
    projects: raw.projects || [],
    tools: raw.tools || [],
    models: raw.models || {},
    schedule: raw.schedule || undefined,
    daily_budget_usd: raw.daily_budget_usd !== undefined ? Number(raw.daily_budget_usd) : 1,
    reports_to: raw.reports_to || 'telegram_digest',
    auto: Array.isArray(raw.auto) ? raw.auto.map(String) : [],
    sources: raw.sources || [],
    platform: raw.platform,
    default_objective: raw.default_objective,
    playbook: raw.playbook,
    file,
  };
}

export class Agents {
  private defs = new Map<string, AgentDef>();
  errors: Record<string, string[]> = {};
  constructor(private db: DB, public dir: string, private tasks: Tasks, private globalCrons: { digest: string; retro: string }) {
    this.load();
  }

  load(): void {
    this.defs.clear();
    this.errors = {};
    if (!fs.existsSync(this.dir)) return;
    for (const f of fs.readdirSync(this.dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      const file = path.join(this.dir, f);
      try {
        const raw = readYaml<any>(file, null);
        const errs = validateAgent(raw);
        if (errs.length) {
          this.errors[f] = errs;
          continue;
        }
        const def = normalize(raw, file);
        this.defs.set(def.id, def);
        this.db.prepare('INSERT OR IGNORE INTO agents_state (id, status) VALUES (?, ?)').run(def.id, 'running');
        if (!this.db.prepare('SELECT 1 FROM playbook_versions WHERE agent_id = ?').get(def.id)) {
          this.db
            .prepare('INSERT INTO playbook_versions (agent_id, version, body, reason, active, created_at) VALUES (?,1,?,?,1,?)')
            .run(def.id, def.playbook || `# ${def.name} playbook\n\n- ${def.mission}`, 'initial (from config)', nowIso());
        }
      } catch (e: any) {
        this.errors[f] = [String(e.message)];
      }
    }
    for (const [f, e] of Object.entries(this.errors)) log('warn', `agent config ${f} invalid`, e.join('; '));
  }

  list(): AgentDef[] {
    return [...this.defs.values()];
  }
  get(id: string): AgentDef | undefined {
    return this.defs.get(id);
  }
  autoFor(id: string | null): string[] {
    return id ? this.defs.get(id)?.auto ?? [] : [];
  }

  state(id: string) {
    return this.db.prepare('SELECT * FROM agents_state WHERE id = ?').get(id) as
      | { id: string; status: AgentStatus; schedule_paused: number; last_run_at: string | null; last_slot: string | null; last_task_id: number | null }
      | undefined;
  }
  status(id: string): AgentStatus {
    return this.state(id)?.status ?? 'stopped';
  }
  setStatus(id: string, s: AgentStatus): void {
    if (!this.defs.has(id)) throw new Error(`no agent ${id}`);
    this.db.prepare('UPDATE agents_state SET status = ? WHERE id = ?').run(s, id);
    if (s === 'running') this.pauseSchedule(id, false);
    emit('agent', { id, status: s });
  }
  pauseSchedule(id: string, paused: boolean): void {
    this.db.prepare('UPDATE agents_state SET schedule_paused = ? WHERE id = ?').run(paused ? 1 : 0, id);
    emit('agent', { id, schedule_paused: paused });
  }
  recordRun(id: string, taskId: number): void {
    this.db.prepare('UPDATE agents_state SET last_run_at = ?, last_task_id = ? WHERE id = ?').run(nowIso(), taskId, id);
  }

  // ── always-allow list lives in the agent's YAML (comments preserved) ──
  addAuto(id: string, actionType: string): void {
    const d = this.defs.get(id);
    if (!d) throw new Error(`no agent ${id}`);
    if (d.auto.includes(actionType)) return;
    setYamlKey(d.file, 'auto', [...d.auto, actionType]);
    this.load();
    emit('auto', { id, actionType, added: true });
  }
  removeAuto(id: string, actionType: string): void {
    const d = this.defs.get(id);
    if (!d) throw new Error(`no agent ${id}`);
    setYamlKey(d.file, 'auto', d.auto.filter((a) => a !== actionType));
    this.load();
    emit('auto', { id, actionType, added: false });
  }
  autoList() {
    return this.list().flatMap((a) => a.auto.map((action) => ({ agent: a.id, action })));
  }

  // ── config editing ──
  rawConfig(id: string): string {
    const d = this.defs.get(id);
    if (!d) throw new Error(`no agent ${id}`);
    return fs.readFileSync(d.file, 'utf8');
  }
  writeConfig(id: string | null, text: string): AgentDef {
    const raw = YAML.parse(text);
    const errs = validateAgent(raw);
    if (errs.length) throw new Error(errs.join('; '));
    if (id && raw.id !== id) throw new Error('changing an agent id is not supported — create a new agent');
    if (!id && this.defs.has(raw.id)) throw new Error(`agent ${raw.id} already exists`);
    const file = id ? this.defs.get(id)!.file : path.join(this.dir, `${raw.id}.yaml`);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
    this.load();
    emit('agent', { id: raw.id, config: true });
    return this.defs.get(raw.id)!;
  }

  // ── playbooks (versioned, revertible) ──
  playbook(id: string): string {
    return (this.db.prepare('SELECT body FROM playbook_versions WHERE agent_id = ? AND active = 1').get(id) as { body: string } | undefined)?.body ?? '';
  }
  playbookVersions(id: string) {
    return this.db.prepare('SELECT id, version, reason, active, created_at, body FROM playbook_versions WHERE agent_id = ? ORDER BY version DESC').all(id);
  }
  applyPlaybook(id: string, body: string, reason: string): number {
    const v = ((this.db.prepare('SELECT MAX(version) v FROM playbook_versions WHERE agent_id = ?').get(id) as { v: number | null }).v ?? 0) + 1;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE playbook_versions SET active = 0 WHERE agent_id = ?').run(id);
      this.db.prepare('INSERT INTO playbook_versions (agent_id, version, body, reason, active, created_at) VALUES (?,?,?,?,1,?)').run(id, v, body, reason, nowIso());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    emit('playbook', { id, version: v });
    return v;
  }
  revertPlaybook(id: string, version: number): void {
    const row = this.db.prepare('SELECT 1 FROM playbook_versions WHERE agent_id = ? AND version = ?').get(id, version);
    if (!row) throw new Error(`no playbook v${version} for ${id}`);
    this.db.prepare('UPDATE playbook_versions SET active = (version = ?) WHERE agent_id = ?').run(version, id);
    emit('playbook', { id, version, reverted: true });
  }

  // ── scheduler ──
  /** Called every tick. Creates at most one task per agent per matching minute. */
  schedule(now = new Date()): TaskRow[] {
    const created: TaskRow[] = [];
    const slot = slotKey(now);
    for (const a of this.list()) {
      const st = this.state(a.id);
      if (!a.schedule || !st || st.status !== 'running' || st.schedule_paused) continue;
      if (st.last_slot === slot || !cronMatches(a.schedule, now)) continue;
      this.db.prepare('UPDATE agents_state SET last_slot = ? WHERE id = ?').run(slot, a.id);
      created.push(this.tasks.create({ objective: a.default_objective || `Scheduled run: ${a.mission}`, agentId: a.id, project: a.projects[0] ?? null, source: 'schedule', kind: 'agent', key: `sched:${a.id}:${slot}` }));
    }
    const g = (name: string, cron: string, make: () => TaskRow[]) => {
      const k = `global:${name}`;
      const last = (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(k) as { value: string } | undefined)?.value;
      if (last === slot || !cronMatches(cron, now)) return;
      this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, slot);
      created.push(...make());
    };
    g('digest', this.globalCrons.digest, () => [this.tasks.create({ objective: `Daily digest ${today(now)}`, kind: 'digest', source: 'schedule', key: `digest:${slot}`, plan: digestPlan() })]);
    g('retro', this.globalCrons.retro, () =>
      this.list()
        .filter((a) => this.status(a.id) === 'running')
        .map((a) => this.tasks.create({ objective: `Weekly retro: ${a.name}`, kind: 'retro', agentId: a.id, source: 'schedule', key: `retro:${a.id}:${slot}`, plan: retroPlan(a) })),
    );
    return created;
  }

  /** Built-in deterministic plans. Null = let the model plan it. */
  planFor(a: AgentDef, task: TaskRow): StepPlan[] | null {
    if (task.kind === 'retro') return retroPlan(a);
    const builtin = BUILTIN[a.id];
    if (!builtin) return null;
    return builtin(a, task);
  }
}

export function digestPlan(): StepPlan[] {
  return [
    { tool: 'system', args: { action: 'digest' }, note: 'Build the digest from today\'s data' },
    { tool: 'notify', args: { text: '{{step.0}}' }, note: 'Send to Telegram' },
    { tool: 'system', args: { action: 'echo', text: '{{step.0}}', result: true } },
  ];
}

export function retroPlan(a: AgentDef): StepPlan[] {
  return [
    { tool: 'system', args: { action: 'agent_stats', agent: a.id, days: 7 }, note: 'Last week vs. metrics' },
    {
      tool: 'think',
      args: {
        kind: 'plan',
        optional: true,
        prompt: `You are Ren 2's ${a.name} agent. Mission: ${a.mission}\n\nCurrent playbook:\n{{playbook}}\n\nLast 7 days:\n{{step.0}}\n\nPropose an improved playbook: concrete best practices only, markdown bullet list, at most 25 lines, keep what works, change what the numbers say isn't working. Then on the final line write "REASON: <one sentence on what changed and why>". If there is too little data to justify a change, return the current playbook unchanged with "REASON: no change — not enough data".`,
      },
      note: 'Propose playbook edits',
    },
    { tool: 'system', args: { action: 'apply_playbook', agent: a.id, text: '{{step.1}}', result: true }, note: 'Auto-apply (versioned, revertible)' },
  ];
}

const BUILTIN: Record<string, (a: AgentDef, t: TaskRow) => StepPlan[] | null> = {
  ops: () => [
    { tool: 'system', args: { action: 'health' }, note: 'Pi health' },
    { tool: 'system', args: { action: 'adapters' }, note: 'Adapter status' },
    { tool: 'system', args: { action: 'queue' }, note: 'Clear Ren 2 queue jams' },
    { tool: 'system', args: { action: 'ops_report', health: '{{step.0}}', adapters: '{{step.1}}', queue: '{{step.2}}', result: true }, note: 'Report' },
  ],

  research: (a, t) => {
    if (t.source !== 'schedule' && !/daily|scan|storefront|orders|convert/i.test(t.objective)) return null;
    const project = t.project || a.projects[0] || 'storefront';
    const steps: StepPlan[] = [
      { tool: 'adapter', args: { adapter: 'storefront', method: 'summary' }, note: 'Storefront numbers' },
      { tool: 'adapter', args: { adapter: 'storefront', method: 'pages', optional: true }, note: 'Offer + page copy' },
      { tool: 'memory', args: { action: 'search', query: `${project} conversion orders pricing findings`, project, limit: 6 }, note: 'What we already know' },
    ];
    for (const url of (a.sources || []).slice(0, 3)) steps.push({ tool: 'http', args: { url, optional: true }, note: `Scan ${new URL(url).hostname}` });
    const n = steps.length;
    const srcRefs = steps.slice(3).map((_, i) => `{{step.${3 + i}}}`).join('\n\n');
    steps.push(
      {
        tool: 'think',
        args: {
          kind: 'research',
          prompt: `${t.objective}\n\nPlaybook:\n{{playbook}}\n\nStorefront summary:\n{{step.0}}\n\nPages/offer:\n{{step.1}}\n\nPrior findings:\n{{step.2}}\n\n${srcRefs ? `Competitor/market pages:\n${srcRefs}\n\n` : ''}Numbers labelled MOCK are fixtures, not real — say so if you rely on them.\nWhy is the store getting visits but no orders? Write:\n## Findings (3–5 bullets, each tied to evidence above)\n## Proposed changes (numbered, concrete, smallest first: what to change, where, expected effect)\n## For Content (one line: the angle Content should post about)`,
          result: true,
        },
        note: 'Analyse',
      },
      { tool: 'memory', args: { action: 'add', kind: 'lesson', project, title: `Research ${today()}: ${project} scan`, body: `{{step.${n}}}` }, note: 'Save findings' },
      { tool: 'handoff', args: { agent: 'content', project, objective: `Draft posts from research ${today()} (${project}). Findings:\n{{step.${n}}}` }, note: 'Hand to Content' },
    );
    return steps;
  },

  content: (a, t) => {
    const project = t.project || a.projects[0] || 'storefront';
    const platform = a.platform || 'drafts';
    return [
      { tool: 'memory', args: { action: 'search', query: `research findings ${project}`, project, limit: 5 }, note: 'Latest research' },
      {
        tool: 'think',
        args: {
          kind: 'write',
          prompt: `Task: ${t.objective}\n\nPlaybook:\n{{playbook}}\n\nResearch:\n{{step.0}}\n\nWrite ONE social post for ${project} (under 260 characters, plain text, no hashtags spam, no invented numbers or claims). Return only the post text.`,
        },
        note: 'Draft post',
      },
      { tool: 'publish', args: { action: 'draft', platform, project, text: '{{step.1}}' }, note: 'Save draft' },
      {
        tool: 'think',
        args: { kind: 'write', optional: true, prompt: `Turn this post into a 30-second vertical video script (hook, 3 beats, call to action). Plain text.\n\nPost:\n{{step.1}}` },
        note: 'Video script',
      },
      { tool: 'adapter', args: { adapter: 'showrunner', method: 'queue_job', optional: true, script: '{{step.3}}', title: t.objective.slice(0, 80) }, note: 'Queue Showrunner job' },
      { tool: 'publish', args: { action: 'publish', platform, draft_id: '{{data.2.id}}', text: '{{step.1}}', result: true }, note: 'Publish (gated)' },
    ];
  },

  sites: (a, t) => [
    { tool: 'memory', args: { action: 'search', query: t.objective, limit: 5 }, note: 'What we know about it' },
    {
      tool: 'think',
      args: {
        kind: 'write',
        prompt: `Kevin asked: ${t.objective}\n\nContext:\n{{step.0}}\n\nPlaybook:\n{{playbook}}\n\nWrite a landing page spec as JSON only: {"name": short-slug, "title": ..., "headline": ..., "subhead": ..., "sections": [{"heading": ..., "body": ...}] (3 sections), "cta": {"label": ..., "href": "#contact"}}. No invented testimonials, prices or stats.`,
      },
      note: 'Page spec',
    },
    { tool: 'adapter', args: { adapter: 'builder', method: 'create_site', spec: '{{step.1}}' }, note: 'Build preview' },
    { tool: 'notify', args: { text: `Preview ready for: ${t.objective.slice(0, 80)}`, link: '{{data.2.preview_url}}' }, note: 'Send preview link' },
    { tool: 'adapter', args: { adapter: 'builder', method: 'publish_site', site_id: '{{data.2.id}}', preview_url: '{{data.2.preview_url}}', result: true }, note: 'Go live (gated)' },
  ],

  outreach: (a, t) => [
    { tool: 'adapter', args: { adapter: 'bge', method: 'prospects', segment: 'trades', limit: 5 }, note: 'Find prospects' },
    { tool: 'memory', args: { action: 'search', query: 'automation pro offer trades outreach', limit: 5 }, note: 'Offer + past lessons' },
    {
      tool: 'think',
      args: {
        kind: 'write',
        prompt: `Task: ${t.objective}\n\nPlaybook:\n{{playbook}}\n\nOffer/context:\n{{step.1}}\n\nProspects:\n{{step.0}}\n\nDraft one short, personal, plain-text email per prospect (≤ 90 words, one concrete reason it fits them, one soft ask, no fake claims). Return JSON only: [{"prospect_id": ..., "subject": ..., "body": ...}].`,
      },
      note: 'Draft messages',
    },
    { tool: 'adapter', args: { adapter: 'bge', method: 'create_drafts', messages: '{{step.2}}' }, note: 'Save drafts in BGE' },
    { tool: 'adapter', args: { adapter: 'bge', method: 'send_drafts', draft_ids: '{{data.3.ids}}', messages: '{{step.2}}', result: true }, note: 'Send (gated)' },
  ],
};
