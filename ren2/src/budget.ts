// Cost log + caps. Every model call is recorded. Daily cap (default $5) and per-agent cap.
// At 80% of the daily cap: one Telegram warning per day. At 100%: cloud calls pause
// until local midnight (a new day key) or until Kevin raises the cap.
import { DB, kvGet, kvSet } from './db.js';
import { emit } from './log.js';
import { today, nowIso } from './env.js';

export interface CostEntry {
  provider: string;
  model: string;
  kind?: string;
  agentId?: string | null;
  taskId?: number | null;
  usd: number;
  tokens?: number;
  cloud: boolean;
}

export class Budget {
  constructor(private db: DB, private defaultCap: number) {}

  cap(): number {
    const day = today();
    const override = kvGet(this.db, `budget.cap.${day}`) ?? kvGet(this.db, 'budget.cap');
    return override !== undefined ? Number(override) : this.defaultCap;
  }

  /** Raise/lower the cap. `todayOnly` = just for today (the "raise until midnight" case). */
  setCap(usd: number, todayOnly = false): void {
    kvSet(this.db, todayOnly ? `budget.cap.${today()}` : 'budget.cap', String(usd));
    emit('budget', this.summary());
  }

  spent(agentId?: string, day = today()): number {
    const r = agentId
      ? this.db.prepare('SELECT COALESCE(SUM(usd),0) s FROM costs WHERE day = ? AND agent_id = ?').get(day, agentId)
      : this.db.prepare('SELECT COALESCE(SUM(usd),0) s FROM costs WHERE day = ?').get(day);
    return Number((r as { s: number }).s);
  }

  taskCost(taskId: number): number {
    return Number((this.db.prepare('SELECT COALESCE(SUM(usd),0) s FROM costs WHERE task_id = ?').get(taskId) as { s: number }).s);
  }

  /** May this agent make a cloud call right now? Local calls are always allowed. */
  allowCloud(agentId?: string | null, agentCap?: number): { ok: boolean; reason?: string } {
    const cap = this.cap();
    if (this.spent() >= cap) return { ok: false, reason: `daily budget $${cap.toFixed(2)} reached — cloud calls paused until midnight or /budget <usd>` };
    if (agentId && agentCap !== undefined && this.spent(agentId) >= agentCap)
      return { ok: false, reason: `agent ${agentId} hit its $${agentCap.toFixed(2)}/day cap` };
    return { ok: true };
  }

  record(e: CostEntry): void {
    const before = this.spent();
    this.db
      .prepare('INSERT INTO costs (ts, day, provider, model, kind, agent_id, task_id, usd, tokens, cloud) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(nowIso(), today(), e.provider, e.model, e.kind ?? null, e.agentId ?? null, e.taskId ?? null, e.usd, e.tokens ?? 0, e.cloud ? 1 : 0);
    const after = before + e.usd;
    const cap = this.cap();
    const day = today();
    if (after >= cap * 0.8 && before < cap * 0.8 && !kvGet(this.db, `budget.warned80.${day}`)) {
      kvSet(this.db, `budget.warned80.${day}`, '1');
      emit('budget.warn', { spent: after, cap, pct: 80 });
    }
    if (after >= cap && before < cap && !kvGet(this.db, `budget.warned100.${day}`)) {
      kvSet(this.db, `budget.warned100.${day}`, '1');
      emit('budget.paused', { spent: after, cap });
    }
    emit('budget', this.summary());
  }

  summary() {
    const cap = this.cap();
    const spent = this.spent();
    const perAgent = this.db
      .prepare("SELECT COALESCE(agent_id, '(chat)') agent, ROUND(SUM(usd), 4) usd, COUNT(*) calls FROM costs WHERE day = ? GROUP BY agent_id ORDER BY usd DESC")
      .all(today());
    const perModel = this.db
      .prepare('SELECT provider, model, ROUND(SUM(usd), 4) usd, COUNT(*) calls FROM costs WHERE day = ? GROUP BY provider, model ORDER BY usd DESC')
      .all(today());
    return { day: today(), cap, spent: Math.round(spent * 10000) / 10000, pct: cap > 0 ? Math.round((spent / cap) * 100) : 100, paused: spent >= cap, perAgent, perModel };
  }
}
