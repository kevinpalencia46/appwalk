// Task persistence. Lifecycle: queued → planning → running → verifying → done | failed |
// needs_decision. Steps are stored individually so a restart resumes from the last
// completed step.
import { DB } from '../db.js';
import { nowIso } from '../env.js';
import { emit } from '../log.js';

export const STATES = ['queued', 'planning', 'running', 'verifying', 'done', 'failed', 'needs_decision'] as const;
export type State = (typeof STATES)[number];

export interface StepPlan {
  tool: string;
  args: Record<string, any>;
  note?: string;
}

export interface TaskRow {
  id: number;
  objective: string;
  kind: string;
  agent_id: string | null;
  project: string | null;
  source: string;
  state: State;
  plan: string | null;
  result: string | null;
  report: string | null;
  error: string | null;
  signature: string | null;
  parent_id: number | null;
  chat_id: string | null;
  key: string | null;
  archived: number;
  dismissed: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface StepRow {
  id: number;
  task_id: number;
  idx: number;
  tool: string;
  args: string;
  note: string | null;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  output: string | null;
  data: string | null;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
}

export function signatureOf(t: { agent_id: string | null; kind: string; objective: string }): string {
  const norm = t.objective.toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#]+/g, ' ').trim().slice(0, 80);
  return `${t.agent_id || 'chat'}|${t.kind}|${norm}`;
}

export class Tasks {
  constructor(private db: DB) {}

  create(i: { objective: string; kind?: string; agentId?: string | null; project?: string | null; source?: string; parentId?: number | null; chatId?: string | null; plan?: StepPlan[]; key?: string }): TaskRow {
    const t = nowIso();
    const kind = i.kind || (i.agentId ? 'agent' : 'chat');
    const sig = signatureOf({ agent_id: i.agentId ?? null, kind, objective: i.objective });
    const r = this.db
      .prepare('INSERT INTO tasks (objective, kind, agent_id, project, source, state, signature, parent_id, chat_id, key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(i.objective, kind, i.agentId ?? null, i.project ?? null, i.source || 'dashboard', 'queued', sig, i.parentId ?? null, i.chatId ?? null, i.key ?? null, t, t);
    const id = Number(r.lastInsertRowid);
    if (i.plan) this.setPlan(id, i.plan);
    const row = this.get(id)!;
    emit('task', row);
    return row;
  }

  get(id: number): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  }
  findByKey(key: string): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE key = ?').get(key) as TaskRow | undefined;
  }

  setState(id: number, state: State, patch: Partial<Pick<TaskRow, 'result' | 'report' | 'error'>> = {}): TaskRow {
    const fin = state === 'done' || state === 'failed' ? nowIso() : null;
    this.db
      .prepare('UPDATE tasks SET state = ?, result = COALESCE(?, result), report = COALESCE(?, report), error = ?, updated_at = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?')
      .run(state, patch.result ?? null, patch.report ?? null, patch.error ?? null, nowIso(), fin, id);
    const row = this.get(id)!;
    emit('task', row);
    return row;
  }

  setPlan(id: number, plan: StepPlan[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE tasks SET plan = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(plan), nowIso(), id);
      this.db.prepare('DELETE FROM steps WHERE task_id = ?').run(id);
      plan.forEach((s, idx) =>
        this.db.prepare('INSERT INTO steps (task_id, idx, tool, args, note) VALUES (?,?,?,?,?)').run(id, idx, s.tool, JSON.stringify(s.args || {}), s.note ?? null),
      );
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  steps(id: number): StepRow[] {
    return this.db.prepare('SELECT * FROM steps WHERE task_id = ? ORDER BY idx').all(id) as unknown as StepRow[];
  }

  stepStart(taskId: number, idx: number): void {
    this.db.prepare("UPDATE steps SET status = 'running', attempts = attempts + 1, started_at = ? WHERE task_id = ? AND idx = ?").run(nowIso(), taskId, idx);
    emit('step', { taskId, idx, status: 'running' });
  }
  stepEnd(taskId: number, idx: number, status: StepRow['status'], output: string, data?: unknown): void {
    this.db
      .prepare('UPDATE steps SET status = ?, output = ?, data = ?, finished_at = ? WHERE task_id = ? AND idx = ?')
      .run(status, output, data === undefined ? null : JSON.stringify(data), nowIso(), taskId, idx);
    emit('step', { taskId, idx, status });
  }
  stepReset(taskId: number, idx: number): void {
    this.db.prepare("UPDATE steps SET status = 'pending' WHERE task_id = ? AND idx = ?").run(taskId, idx);
  }
  updateStepArgs(taskId: number, idx: number, args: Record<string, any>): void {
    this.db.prepare('UPDATE steps SET args = ? WHERE task_id = ? AND idx = ?').run(JSON.stringify(args), taskId, idx);
  }

  list(o: { state?: string; agentId?: string; archived?: boolean; limit?: number } = {}): TaskRow[] {
    const where = ['dismissed = 0'];
    const args: (string | number)[] = [];
    if (!o.archived) where.push('archived = 0');
    if (o.state) (where.push('state = ?'), args.push(o.state));
    if (o.agentId) (where.push('agent_id = ?'), args.push(o.agentId));
    return this.db.prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, o.limit ?? 100) as unknown as TaskRow[];
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = Object.fromEntries(STATES.map((s) => [s, 0]));
    for (const r of this.db.prepare('SELECT state, COUNT(*) n FROM tasks WHERE archived = 0 AND dismissed = 0 GROUP BY state').all() as { state: string; n: number }[]) out[r.state] = r.n;
    return out;
  }

  /** Tasks the runner should pick up: queued, plus anything mid-flight (restart resume). */
  runnable(limit: number, exclude: number[]): TaskRow[] {
    const ex = exclude.length ? `AND id NOT IN (${exclude.map(Number).join(',')})` : '';
    return this.db.prepare(`SELECT * FROM tasks WHERE state IN ('queued','planning','running','verifying') ${ex} ORDER BY id LIMIT ?`).all(limit) as unknown as TaskRow[];
  }

  requeue(id: number): TaskRow {
    return this.setState(id, 'queued');
  }

  dismiss(id: number): void {
    this.db.prepare('UPDATE tasks SET dismissed = 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
    emit('task', this.get(id));
  }

  /** Done tasks older than 30 days leave the default views. Never deleted. */
  archiveOld(days = 30): number {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    return Number(this.db.prepare("UPDATE tasks SET archived = 1 WHERE state = 'done' AND archived = 0 AND finished_at < ?").run(cutoff).changes);
  }
}
