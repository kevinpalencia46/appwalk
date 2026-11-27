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

export interface Job {
  id: string;
  do: string; // the objective this job works on
  every?: string; // cron; absent = on demand only
  project?: string;
}

/** Tools every agent has: thinking, memory, talking to teammates and to Kevin. */
export const ALWAYS_TOOLS = ['think', 'memory', 'message', 'handoff', 'notify'];

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
  jobs: Job[];
  /** Project access: adapter id → allowed methods ("*" = all, "read" = all read methods). */
  access: Record<string, string[]>;
  skills: string[];
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
  if (raw.jobs !== undefined) {
    if (!Array.isArray(raw.jobs)) errs.push('jobs must be a list');
    else
      raw.jobs.forEach((j: any, i: number) => {
        if (!j?.id || !j?.do) errs.push(`jobs[${i}] needs id and do`);
        if (j?.every && !validCron(String(j.every))) errs.push(`jobs[${i}].every "${j.every}" is not a valid cron`);
      });
  }
  if (raw.access !== undefined && (typeof raw.access !== 'object' || Array.isArray(raw.access))) errs.push('access must be a mapping of project → methods');
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
    jobs: normalizeJobs(raw),
    access: Object.fromEntries(Object.entries(raw.access || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]])),
    skills: Array.isArray(raw.skills) ? raw.skills.map(String) : [],
    file,
  };
}

function normalizeJobs(raw: any): Job[] {
  if (Array.isArray(raw.jobs) && raw.jobs.length) return raw.jobs.map((j: any) => ({ id: String(j.id), do: String(j.do), every: j.every ? String(j.every) : undefined, project: j.project }));
  // Older single-schedule configs become one job.
  if (raw.schedule || raw.default_objective) return [{ id: 'main', do: String(raw.default_objective || `Scheduled run: ${raw.mission}`), every: raw.schedule || undefined }];
  return [];
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
  /** Called every tick. Each job fires at most once per matching minute. */
  schedule(now = new Date()): TaskRow[] {
    const created: TaskRow[] = [];
    const slot = slotKey(now);
    for (const a of this.list()) {
      const st = this.state(a.id);
      if (!st || st.status !== 'running' || st.schedule_paused) continue;
      for (const j of a.jobs) {
        if (!j.every || !cronMatches(j.every, now)) continue;
        const js = this.db.prepare('SELECT last_slot FROM job_state WHERE agent_id = ? AND job_id = ?').get(a.id, j.id) as { last_slot: string } | undefined;
        if (js?.last_slot === slot) continue;
        const t = this.runJob(a, j, 'schedule', slot);
        if (t) created.push(t);
      }
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

  /** Start one job now (schedule or "run now"). Returns the task, or null if that job slot already ran. */
  runJob(a: AgentDef, j: Job, source: 'schedule' | 'dashboard', slot = slotKey(new Date())): TaskRow | null {
    const key = `job:${a.id}:${j.id}:${slot}${source === 'dashboard' ? ':' + Date.now() : ''}`;
    if (this.tasks.findByKey(key)) return null;
    this.db
      .prepare('INSERT INTO job_state (agent_id, job_id, last_slot, last_run_at) VALUES (?,?,?,?) ON CONFLICT(agent_id, job_id) DO UPDATE SET last_slot = excluded.last_slot, last_run_at = excluded.last_run_at')
      .run(a.id, j.id, source === 'schedule' ? slot : null, nowIso());
    this.db.prepare('UPDATE agents_state SET last_slot = ? WHERE id = ?').run(slot, a.id);
    const t = this.tasks.create({ objective: j.do, agentId: a.id, project: j.project ?? a.projects[0] ?? null, source, kind: 'agent', key });
    this.db.prepare('UPDATE tasks SET job_id = ? WHERE id = ?').run(j.id, t.id);
    this.db.prepare('UPDATE job_state SET last_task_id = ? WHERE agent_id = ? AND job_id = ?').run(t.id, a.id, j.id);
    return this.tasks.get(t.id)!;
  }

  jobState(agentId: string) {
    return this.db.prepare('SELECT * FROM job_state WHERE agent_id = ?').all(agentId) as { job_id: string; last_run_at: string | null; last_task_id: number | null }[];
  }

  /** Busy = this agent already has a task in flight (one thing at a time per desk). */
  busy(agentId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE agent_id = ? AND state IN ('queued','planning','running','verifying') AND archived = 0 AND dismissed = 0 LIMIT 1").get(agentId));
  }

  canUse(a: AgentDef, tool: string): boolean {
    return ALWAYS_TOOLS.includes(tool) || a.tools.includes(tool) || (tool === 'system' && a.id === 'ops');
  }

  /** Project access check for adapter methods. */
  canCall(a: AgentDef, adapter: string, method: string, kind: 'read' | 'action'): boolean {
    const allowed = a.access[adapter];
    if (!allowed) return false;
    return allowed.includes('*') || allowed.includes(method) || (kind === 'read' && allowed.includes('read'));
  }

  /** Today's spending cap for an agent (Ren may move budget between agents within the daily cap). */
  capFor(id: string): number {
    const o = (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(`agentcap.${today()}.${id}`) as { value: string } | undefined)?.value;
    return o !== undefined ? Number(o) : this.defs.get(id)?.daily_budget_usd ?? 0;
  }
  setCapToday(id: string, usd: number): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`agentcap.${today()}.${id}`, String(usd));
    emit('agent', { id, cap: usd });
  }

  /** Retro plans live here; each desk's job plans live in plans.ts. */
  planFor(a: AgentDef, task: TaskRow): StepPlan[] | null {
    if (task.kind === 'retro') return retroPlan(a);
    return null;
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
