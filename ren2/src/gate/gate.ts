// The only four gates: money, publish, contact, destroy. A gated action either runs
// because the agent has that action type on its `auto` list ("Always allow this"), or
// it creates a decision that waits — forever — for Kevin. Decisions never expire into
// an approval; after 48h a pending decision is marked stale and reminded once.
import { DB } from '../db.js';
import { nowIso } from '../env.js';
import { emit } from '../log.js';

export const GATES = ['money', 'publish', 'contact', 'destroy'] as const;
export type GateKind = (typeof GATES)[number];

export interface Decision {
  id: number;
  task_id: number | null;
  step_idx: number | null;
  agent_id: string | null;
  gate: GateKind;
  action_type: string;
  summary: string;
  preview: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'edit_requested' | 'stale' | 'superseded';
  response: string | null;
  reminded: number;
  tg_message_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export class NeedsDecision extends Error {
  constructor(public decisionId: number) {
    super(`waiting for Kevin's decision #${decisionId}`);
  }
}
export class Rejected extends Error {
  constructor(public decisionId: number, public note?: string | null) {
    super(`Kevin rejected decision #${decisionId}${note ? `: ${note}` : ''}`);
  }
}

export interface GateRequest {
  taskId: number;
  stepIdx: number;
  agentId: string | null;
  gate: GateKind;
  actionType: string; // e.g. "post:x", "deploy:public", "email:send"
  summary: string;
  preview?: string;
}

export type AutoLookup = (agentId: string | null) => string[];

export class Gate {
  constructor(private db: DB, private autoFor: AutoLookup) {}

  isAuto(agentId: string | null, actionType: string): boolean {
    if (!agentId) return false;
    const auto = this.autoFor(agentId);
    return auto.includes(actionType) || auto.includes(actionType.split(':')[0] + ':*');
  }

  latestFor(taskId: number, stepIdx: number): Decision | undefined {
    return this.db.prepare('SELECT * FROM decisions WHERE task_id = ? AND step_idx = ? ORDER BY id DESC LIMIT 1').get(taskId, stepIdx) as Decision | undefined;
  }

  /**
   * Called by a tool before a gated action. Returns normally when the action may run.
   * Throws NeedsDecision (task parks in needs_decision) or Rejected.
   * `revised` = the caller already applied an edit and wants to ask again.
   */
  require(r: GateRequest, revised = false): 'auto' | 'approved' {
    if (this.isAuto(r.agentId, r.actionType)) return 'auto';
    const last = this.latestFor(r.taskId, r.stepIdx);
    if (last && !revised) {
      if (last.status === 'approved') return 'approved';
      if (last.status === 'rejected') throw new Rejected(last.id, last.response);
      if (last.status === 'pending' || last.status === 'stale') throw new NeedsDecision(last.id);
      // edit_requested falls through: caller should revise first; if it didn't, ask again.
    }
    if (last && (last.status === 'pending' || last.status === 'stale')) {
      this.db.prepare("UPDATE decisions SET status = 'superseded', resolved_at = ? WHERE id = ?").run(nowIso(), last.id);
    }
    const res = this.db
      .prepare('INSERT INTO decisions (task_id, step_idx, agent_id, gate, action_type, summary, preview, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(r.taskId, r.stepIdx, r.agentId, r.gate, r.actionType, r.summary.slice(0, 500), (r.preview || '').slice(0, 3500), 'pending', nowIso());
    const id = Number(res.lastInsertRowid);
    emit('decision.new', this.get(id));
    throw new NeedsDecision(id);
  }

  get(id: number): Decision | undefined {
    return this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as Decision | undefined;
  }

  list(status?: string): Decision[] {
    return (status
      ? this.db.prepare('SELECT * FROM decisions WHERE status = ? ORDER BY id DESC LIMIT 200').all(status)
      : this.db.prepare('SELECT * FROM decisions ORDER BY id DESC LIMIT 200').all()) as unknown as Decision[];
  }

  open(): Decision[] {
    return this.db.prepare("SELECT * FROM decisions WHERE status IN ('pending','stale') ORDER BY id").all() as unknown as Decision[];
  }

  /** approve | reject | edit | always. Returns the decision after the change. */
  resolve(id: number, action: 'approve' | 'reject' | 'edit' | 'always', text?: string): Decision {
    const d = this.get(id);
    if (!d) throw new Error(`no decision ${id}`);
    if (!['pending', 'stale'].includes(d.status)) throw new Error(`decision ${id} is already ${d.status}`);
    const status = action === 'reject' ? 'rejected' : action === 'edit' ? 'edit_requested' : 'approved';
    if (action === 'edit' && !text?.trim()) throw new Error('edit needs the change you want');
    this.db.prepare('UPDATE decisions SET status = ?, response = ?, resolved_at = ? WHERE id = ?').run(status, text ?? null, nowIso(), id);
    const out = this.get(id)!;
    emit('decision.resolved', { ...out, always: action === 'always' });
    return out;
  }

  setMessageId(id: number, mid: string): void {
    this.db.prepare('UPDATE decisions SET tg_message_id = ? WHERE id = ?').run(mid, id);
  }

  /** Pending > 48h → stale + one reminder. Never auto-approves. Returns decisions to remind. */
  sweepStale(now = Date.now(), ageMs = 48 * 3600_000): Decision[] {
    const rows = this.db.prepare("SELECT * FROM decisions WHERE status = 'pending' AND reminded = 0").all() as unknown as Decision[];
    const out: Decision[] = [];
    for (const d of rows) {
      if (now - Date.parse(d.created_at) < ageMs) continue;
      this.db.prepare("UPDATE decisions SET status = 'stale', reminded = 1 WHERE id = ?").run(d.id);
      out.push(this.get(d.id)!);
    }
    if (out.length) emit('decision.stale', out);
    return out;
  }
}
