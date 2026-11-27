// How agents work together. Every agent has an inbox; "*" is the team board.
//  - request: "please do X" → the recipient's work loop turns it into a task; when that
//    task finishes, a reply with the result goes back to the sender automatically.
//  - fyi:     findings/updates for one agent or the whole team ("*"); read as context.
//  - reply:   the result of a request.
// Kevin can drop requests on any desk too (from = "kevin").
import { DB } from '../db.js';
import { nowIso } from '../env.js';
import { emit } from '../log.js';

export type MessageKind = 'request' | 'fyi' | 'reply';
export type MessageStatus = 'unread' | 'read' | 'in_progress' | 'done' | 'failed';

export interface Message {
  id: number;
  from_agent: string;
  to_agent: string;
  kind: MessageKind;
  subject: string;
  body: string;
  project: string | null;
  status: MessageStatus;
  task_id: number | null;
  origin_task_id: number | null;
  reply_to: number | null;
  key: string | null;
  priority: number;
  idle_only: number;
  created_at: string;
  updated_at: string;
}

export const TEAM = '*';

export class Messages {
  constructor(private db: DB) {}

  send(m: { from: string; to: string; kind: MessageKind; subject: string; body?: string; project?: string | null; originTaskId?: number | null; replyTo?: number | null; key?: string; priority?: number; idleOnly?: boolean }): Message {
    if (m.key) {
      const prev = this.db.prepare('SELECT * FROM messages WHERE key = ?').get(m.key) as Message | undefined;
      if (prev) return prev; // idempotent per step: a re-run after restart doesn't double-send
    }
    const t = nowIso();
    const r = this.db
      .prepare('INSERT INTO messages (from_agent, to_agent, kind, subject, body, project, status, origin_task_id, reply_to, key, priority, idle_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(m.from, m.to, m.kind, m.subject.slice(0, 300), (m.body ?? '').slice(0, 8000), m.project ?? null, 'unread', m.originTaskId ?? null, m.replyTo ?? null, m.key ?? null, m.priority ?? 0, m.idleOnly ? 1 : 0, t, t);
    const msg = this.get(Number(r.lastInsertRowid))!;
    emit('message', msg);
    return msg;
  }

  get(id: number): Message | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message | undefined;
  }

  set(id: number, patch: { status?: MessageStatus; task_id?: number }): void {
    const m = this.get(id);
    if (!m) return;
    this.db.prepare('UPDATE messages SET status = ?, task_id = ?, updated_at = ? WHERE id = ?').run(patch.status ?? m.status, patch.task_id ?? m.task_id, nowIso(), id);
    emit('message', this.get(id));
  }

  /** Requests waiting for this agent: high priority first (e.g. Worklane sign-ups), then oldest. */
  pendingRequests(agentId: string): Message[] {
    return this.db.prepare("SELECT * FROM messages WHERE to_agent = ? AND kind = 'request' AND status = 'unread' ORDER BY priority DESC, id").all(agentId) as unknown as Message[];
  }

  inbox(agentId: string, limit = 20): Message[] {
    return this.db.prepare('SELECT * FROM messages WHERE to_agent IN (?, ?) AND from_agent != ? ORDER BY id DESC LIMIT ?').all(agentId, TEAM, agentId, limit) as unknown as Message[];
  }

  outbox(agentId: string, limit = 20): Message[] {
    return this.db.prepare('SELECT * FROM messages WHERE from_agent = ? ORDER BY id DESC LIMIT ?').all(agentId, limit) as unknown as Message[];
  }

  board(limit = 40): Message[] {
    return this.db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit) as unknown as Message[];
  }

  /** Recent FYIs and replies for an agent (incl. team board) as compact planning context. */
  context(agentId: string, limit = 5, maxChars = 1500): string {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE to_agent IN (?, ?) AND kind IN ('fyi','reply') AND from_agent != ? ORDER BY id DESC LIMIT ?")
      .all(agentId, TEAM, agentId, limit) as unknown as Message[];
    let used = 0;
    const out: string[] = [];
    for (const m of rows) {
      const chunk = `From ${m.from_agent}${m.to_agent === TEAM ? ' (team)' : ''}: ${m.subject}\n${m.body.slice(0, 500)}`;
      if (used + chunk.length > maxChars) break;
      out.push(chunk);
      used += chunk.length;
    }
    return out.join('\n\n');
  }

  counts(agentId: string) {
    const q = (sql: string) => (this.db.prepare(sql).get(agentId) as { n: number }).n;
    return {
      waiting: q("SELECT COUNT(*) n FROM messages WHERE to_agent = ? AND kind = 'request' AND status = 'unread'"),
      inProgress: q("SELECT COUNT(*) n FROM messages WHERE to_agent = ? AND kind = 'request' AND status = 'in_progress'"),
      unreadFyi: q("SELECT COUNT(*) n FROM messages WHERE to_agent = ? AND kind != 'request' AND status = 'unread'"),
    };
  }

  markRead(agentId: string): void {
    this.db.prepare("UPDATE messages SET status = 'read', updated_at = ? WHERE to_agent = ? AND kind != 'request' AND status = 'unread'").run(nowIso(), agentId);
  }
}
