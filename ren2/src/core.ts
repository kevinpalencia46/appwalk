// Core: wires every module together in one process and holds the small amount of
// glue (chat → task, decisions → tasks, notifications, digest, stats).
import { DB, openDb } from './db.js';
import { Settings, ensureDirs, today, nowIso } from './env.js';
import { Budget } from './budget.js';
import { Router } from './router/router.js';
import { Provider, defaultProviders } from './router/providers.js';
import { Memory } from './memory/memory.js';
import { Gate, Decision } from './gate/gate.js';
import { Tasks, TaskRow } from './tasks/store.js';
import { Runner } from './tasks/runner.js';
import { detectProject } from './tasks/planner.js';
import path from 'node:path';
import os from 'node:os';
import { Agents } from './agents/agents.js';
import { Messages, Message } from './agents/messages.js';
import { Skills } from './agents/skills.js';
import { cronMatches } from './agents/cron.js';
import { Tools } from './tools/index.js';
import { Adapters } from './adapters/index.js';
import { Adapter } from './adapters/base.js';
import { publishers, Publisher, Drafts } from './adapters/publisher.js';
import { Telegram } from './telegram/telegram.js';
import { bus, emit, log } from './log.js';
import { Sector, loadSectors } from './hq.js';

export interface CoreOptions {
  providers?: Record<string, Provider>;
  adapters?: Adapter[];
}

export class Core {
  db: DB;
  budget: Budget;
  router: Router;
  memory: Memory;
  gate: Gate;
  tasks: Tasks;
  agents: Agents;
  messages: Messages;
  skills: Skills;
  private _sectors: { at: number; v: Sector[] } | null = null;
  tools: Tools;
  adapters: Adapters;
  publishers: Record<string, Publisher>;
  drafts: Drafts;
  runner: Runner;
  telegram: Telegram;
  private timers: NodeJS.Timeout[] = [];
  private listener: ((e: any) => void) | null = null;
  startedAt = nowIso();

  constructor(public settings: Settings, opts: CoreOptions = {}) {
    ensureDirs(settings);
    this.db = openDb(settings.dbPath);
    this.budget = new Budget(this.db, settings.dailyBudgetUsd);
    this.router = new Router(this.budget, settings.configDir, opts.providers ?? defaultProviders(), settings.providersOff);
    this.memory = new Memory(this.db, settings.knowledgeDir);
    this.tasks = new Tasks(this.db);
    this.agents = new Agents(this.db, settings.agentsDir, this.tasks, { digest: settings.digestCron, retro: settings.retroCron });
    this.messages = new Messages(this.db);
    this.skills = new Skills(settings.skillsDir);
    this.gate = new Gate(this.db, (id) => this.agents.autoFor(id));
    this.tools = new Tools();
    this.adapters = new Adapters(settings.adapterMode, settings.workspace, opts.adapters);
    this.publishers = publishers();
    this.drafts = new Drafts(this.db);
    this.runner = new Runner(this);
    this.telegram = new Telegram(this);
  }

  start(): void {
    const idx = this.memory.indexNotes();
    log('info', `memory indexed`, idx);
    this.listener = (e) => void this.onEvent(e).catch((err) => log('warn', 'event handler', String(err.message)));
    bus.on('event', this.listener);
    this.runner.start();
    this.timers.push(setInterval(() => this.memory.indexNotes(), 30_000));
    this.timers.push(setInterval(() => this.scheduleTick(), 20_000));
    this.timers.push(setInterval(() => this.workLoop(), 2_000));
    this.timers.push(setInterval(() => this.tasks.archiveOld(), 3600_000));
    this.scheduleTick();
    this.telegram.start();
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.listener) bus.off('event', this.listener);
    this.telegram.stop();
    await this.runner.stop();
    this.db.close();
  }

  scheduleTick(now = new Date()): TaskRow[] {
    if (this.runner.halted()) return [];
    const created = [...this.agents.schedule(now), ...this.workLoop()];
    for (const d of this.gate.sweepStale()) void this.telegram.send(`⏳ Reminder: decision #${d.id} has waited 48h (now in Stale). It stays pending until you answer.\n${d.summary}`);
    if (created.length) this.runner.tick();
    return created;
  }

  /**
   * Autonomy: every running agent that isn't busy picks up the oldest request in its
   * inbox (from a teammate or Kevin) and starts working on it. One thing at a time per desk.
   */
  workLoop(): TaskRow[] {
    if (this.runner.halted()) return [];
    const created: TaskRow[] = [];
    for (const a of this.agents.list()) {
      if (this.agents.status(a.id) !== 'running' || this.agents.busy(a.id)) continue;
      // Idle-only work (e.g. speculative demo builds) waits until the machine is quiet.
      const m = this.messages.pendingRequests(a.id).find((x) => !x.idle_only || this.systemIdle());
      if (!m) continue;
      const t = this.tasks.create({
        objective: m.body ? `${m.subject}\n\n${m.body}` : m.subject,
        agentId: a.id,
        project: m.project ?? a.projects[0] ?? null,
        source: m.from_agent === 'kevin' ? 'dashboard' : 'agent',
        parentId: m.origin_task_id,
        kind: 'agent',
        key: `msg:${m.id}`,
      });
      // A request that names one of this agent's jobs runs that job's plan.
      const job = a.jobs.find((j) => new RegExp(`\\b${j.id}\\b`, 'i').test(m.subject));
      this.db.prepare('UPDATE tasks SET message_id = ?, job_id = ? WHERE id = ?').run(m.id, job?.id ?? null, t.id);
      this.messages.set(m.id, { status: 'in_progress', task_id: t.id });
      created.push(this.tasks.get(t.id)!);
    }
    if (created.length) this.runner.tick();
    return created;
  }

  /** Sectors config (re-read at most every 10 s so edits apply without a restart). */
  get sectors(): Sector[] {
    if (!this._sectors || Date.now() - this._sectors.at > 10_000) this._sectors = { at: Date.now(), v: loadSectors(this.settings.configDir) };
    return this._sectors.v;
  }

  /** Quiet enough for background work: nothing else running and load under half the cores. */
  systemIdle(): boolean {
    return this.runner.active.size === 0 && os.loadavg()[0] < os.cpus().length * 0.5;
  }

  /** Kevin drops work on an agent's desk. */
  assign(agentId: string, subject: string, body = ''): Message {
    if (!this.agents.get(agentId)) throw new Error(`no agent ${agentId}`);
    const m = this.messages.send({ from: 'kevin', to: agentId, kind: 'request', subject, body });
    this.workLoop();
    return m;
  }

  /** Everything on one agent's desk, for the dashboard. */
  desk(id: string) {
    const a = this.agents.get(id);
    if (!a) throw new Error(`no agent ${id}`);
    const st = this.agents.state(id);
    const current = this.db.prepare("SELECT * FROM tasks WHERE agent_id = ? AND state IN ('planning','running','verifying','queued','needs_decision') AND dismissed = 0 ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'planning' THEN 0 WHEN 'verifying' THEN 0 WHEN 'needs_decision' THEN 1 ELSE 2 END, id LIMIT 5").all(id) as unknown as TaskRow[];
    const now = current.find((t) => ['planning', 'running', 'verifying'].includes(t.state));
    const nowSteps = now ? this.tasks.steps(now.id) : [];
    const runningStep = nowSteps.find((s) => s.status === 'running');
    const js = this.agents.jobState(id);
    const recent = this.db.prepare("SELECT id, objective, state, result, error, finished_at, job_id FROM tasks WHERE agent_id = ? AND state IN ('done','failed') AND dismissed = 0 ORDER BY id DESC LIMIT 6").all(id) as any[];
    return {
      id: a.id,
      name: a.name,
      mission: a.mission,
      status: st?.status ?? 'stopped',
      schedulePaused: Boolean(st?.schedule_paused),
      now: now ? { id: now.id, objective: now.objective, state: now.state, step: runningStep ? { idx: runningStep.idx, tool: runningStep.tool, note: runningStep.note } : null, steps: nowSteps.length, done: nowSteps.filter((s) => s.status === 'done').length } : null,
      queue: current.filter((t) => t !== now).map((t) => ({ id: t.id, objective: t.objective, state: t.state })),
      waitingOnKevin: this.gate.open().filter((d) => d.agent_id === id),
      inbox: this.messages.inbox(id, 12),
      outbox: this.messages.outbox(id, 8),
      counts: this.messages.counts(id),
      jobs: a.jobs.map((j) => {
        const s = js.find((x) => x.job_id === j.id);
        return { ...j, lastRunAt: s?.last_run_at ?? null, lastTaskId: s?.last_task_id ?? null, nextRun: j.every && st?.status === 'running' && !st?.schedule_paused ? this.nextRun(j.every)?.toISOString() ?? null : null };
      }),
      recent: recent.map((r) => ({ ...r, result: (r.result || r.error || '').slice(0, 500) })),
      access: a.access,
      tools: [...new Set([...a.tools])],
      skills: a.skills.map((sid) => {
        const sk = this.skills.get(sid);
        return sk ? { id: sk.id, name: sk.name, description: sk.description, projects: sk.projects } : { id: sid, name: sid, description: 'missing skill file', projects: [], missing: true };
      }),
      projects: a.projects,
      budget: { spent: this.budget.spent(id), cap: a.daily_budget_usd },
      playbook: this.agents.playbook(id),
      lastRunAt: st?.last_run_at ?? null,
      stats: this.agentStats(id, 7),
      auto: a.auto,
      file: path.relative(path.dirname(this.settings.agentsDir), a.file),
    };
  }

  alert(level: 'info' | 'warn' | 'error', message: string, key?: string): void {
    if (key && this.db.prepare('SELECT 1 FROM alerts WHERE key = ? AND dismissed = 0').get(key)) return;
    this.db.prepare('INSERT INTO alerts (level, message, key, created_at) VALUES (?,?,?,?)').run(level, message, key ?? null, nowIso());
    emit('alert', { level, message });
  }
  alerts() {
    return this.db.prepare('SELECT * FROM alerts WHERE dismissed = 0 ORDER BY id DESC LIMIT 50').all();
  }

  /** Dashboard or Telegram message → task for the planner. */
  chat(source: 'telegram' | 'dashboard', text: string, chatId?: string, explicitTask = false): TaskRow {
    // Kevin talks to Ren: Ren answers or delegates to the desks.
    const ren = this.agents.get('ren') && this.agents.status('ren') === 'running' ? 'ren' : null;
    const task = this.tasks.create({ objective: text.slice(0, 2000), kind: explicitTask ? 'request' : 'chat', agentId: ren, project: detectProject(text), source, chatId: chatId ?? null });
    this.db.prepare('INSERT INTO chat (source, role, text, task_id, created_at) VALUES (?,?,?,?,?)').run(source, 'kevin', text, task.id, nowIso());
    emit('chat', { role: 'kevin', text, taskId: task.id });
    this.runner.tick();
    return task;
  }
  chatHistory(limit = 40) {
    return (this.db.prepare('SELECT * FROM chat ORDER BY id DESC LIMIT ?').all(limit) as any[]).reverse();
  }

  decide(id: number, action: 'approve' | 'reject' | 'edit' | 'always', text?: string, by = 'dashboard'): Decision {
    const d = this.gate.resolve(id, action, text);
    if (action === 'always' && d.agent_id && this.agents.get(d.agent_id)) this.agents.addAuto(d.agent_id, d.action_type);
    log('info', `decision #${id} ${action} by ${by}`);
    if (d.task_id) {
      const t = this.tasks.get(d.task_id);
      if (t && t.state === 'needs_decision') this.tasks.requeue(t.id);
      this.runner.tick();
    }
    return d;
  }

  async onTaskFinished(t: TaskRow): Promise<void> {
    const mid = (t as any).message_id as number | null;
    if (mid) {
      const m = this.messages.get(mid);
      if (m && m.status !== 'done' && m.status !== 'failed') {
        this.messages.set(m.id, { status: t.state === 'done' ? 'done' : 'failed' });
        const body = t.state === 'done' ? (t.result || '(done, no result)') : `Couldn't finish: ${(t.error || '').slice(0, 600)}`;
        this.messages.send({ from: t.agent_id || 'ren', to: m.from_agent, kind: 'reply', subject: `Re: ${m.subject}`, body, project: m.project, originTaskId: t.id, replyTo: m.id, key: `reply:${m.id}` });
        // Ren delegated part of Kevin's chat request: pass the result on to Kevin.
        const origin = m.origin_task_id ? this.tasks.get(m.origin_task_id) : undefined;
        if (m.from_agent === 'ren' && origin && (origin.kind === 'chat' || origin.kind === 'request') && t.state === 'done') {
          const text = `${t.agent_id} finished "${m.subject}":\n${body}`;
          this.db.prepare('INSERT INTO chat (source, role, text, task_id, created_at) VALUES (?,?,?,?,?)').run(origin.source, 'ren', text, t.id, nowIso());
          emit('chat', { role: 'ren', text, taskId: t.id });
          if (origin.source === 'telegram') await this.telegram.send(`${text.slice(0, 1500)}${this.telegram.link('work/' + t.id)}`);
        }
        if (m.from_agent === 'kevin') await this.telegram.send(`${t.agent_id}: ${t.state === 'done' ? '✅' : '⚠'} ${m.subject}\n${body.slice(0, 900)}${this.telegram.link('agents/' + t.agent_id)}`);
      }
      this.workLoop();
    }
    if (t.kind === 'chat' || t.kind === 'request' || t.source === 'telegram' || t.source === 'dashboard') {
      const text = t.state === 'done' ? t.result || '(no result)' : `⚠ Task #${t.id} failed: ${(t.error || '').slice(0, 400)}`;
      this.db.prepare('INSERT INTO chat (source, role, text, task_id, created_at) VALUES (?,?,?,?,?)').run(t.source, 'ren', text, t.id, nowIso());
      emit('chat', { role: 'ren', text, taskId: t.id });
      if (t.source === 'telegram') await this.telegram.send(`${text}${this.telegram.link('work/' + t.id)}`);
      return;
    }
    const a = t.agent_id ? this.agents.get(t.agent_id) : null;
    if (a?.reports_to === 'telegram_now' && t.state === 'done') await this.telegram.send(`${a.name}: ${(t.result || '').slice(0, 1200)}${this.telegram.link('work/' + t.id)}`);
  }

  private async onEvent(e: { type: string; data: any }): Promise<void> {
    switch (e.type) {
      case 'decision.new':
        return this.telegram.sendDecision(e.data);
      case 'budget.warn':
        this.alert('warn', `Budget at 80%: $${e.data.spent.toFixed(2)} of $${e.data.cap.toFixed(2)} today`, `budget80:${today()}`);
        return void (await this.telegram.send(`💸 Budget 80%: $${e.data.spent.toFixed(2)} of $${e.data.cap.toFixed(2)} spent today. /budget <usd> to raise.`));
      case 'budget.paused':
        this.alert('error', `Daily budget reached — cloud calls paused until midnight`, `budget100:${today()}`);
        return void (await this.telegram.send(`⛔ Daily budget $${e.data.cap.toFixed(2)} reached. Cloud calls paused until midnight. Local models still run. /budget <usd> to raise.`));
      case 'failure.recurring':
        return void (await this.telegram.send(`🔁 Recurring failure (3×)${e.data.agentId ? ` — ${e.data.agentId} schedule paused` : ''}:\n${e.data.error}${this.telegram.link('work/' + e.data.itemTaskId)}`));
    }
  }

  // ── summaries (Telegram + dashboard) ──
  statusSummary() {
    const b = this.budget.summary();
    return {
      halted: this.runner.halted(),
      startedAt: this.startedAt,
      tasks: this.tasks.counts(),
      active: [...this.runner.active.keys()],
      decisions: this.gate.open().length,
      budget: { spent: b.spent, cap: b.cap, pct: b.pct, paused: b.paused },
      agents: this.agents.list().map((a) => ({ id: a.id, status: this.agents.status(a.id) })),
      adapterMode: this.settings.adapterMode,
      telegram: this.telegram.status().status,
      ownerToken: Boolean(this.settings.ownerToken),
    };
  }

  statusText(): string {
    const s = this.statusSummary();
    const c = s.tasks;
    return [
      `Ren 2 ${s.halted ? '🛑 HALTED' : '🟢 running'}`,
      `Tasks: ${c.running + c.planning + c.verifying} active · ${c.queued} queued · ${c.needs_decision} waiting on you · ${c.failed} failed`,
      `Decisions pending: ${s.decisions}`,
      `Spend today: $${s.budget.spent.toFixed(2)} / $${s.budget.cap.toFixed(2)}${s.budget.paused ? ' (cloud paused)' : ''}`,
      `Agents: ${s.agents.map((a) => `${a.id} ${a.status === 'running' ? '▶' : a.status === 'paused' ? '⏸' : '■'}`).join(' · ') || 'none'}`,
      `Adapters: ${s.adapterMode.toUpperCase()}`,
    ].join('\n');
  }

  agentsText(): string {
    return (
      this.agents
        .list()
        .map((a) => {
          const st = this.agents.state(a.id);
          return `${a.name} (${a.id}) — ${st?.status}${st?.schedule_paused ? ', schedule paused' : ''}\n  ${a.schedule ? `cron ${a.schedule}` : 'on demand'} · $${this.budget.spent(a.id).toFixed(2)}/$${a.daily_budget_usd.toFixed(2)} today · last run ${st?.last_run_at ? new Date(st.last_run_at).toLocaleString() : 'never'}`;
        })
        .join('\n') || 'No agents configured.'
    );
  }

  budgetText(): string {
    const b = this.budget.summary();
    const lines = (b.perAgent as any[]).map((r) => `  ${r.agent}: $${Number(r.usd).toFixed(3)} (${r.calls} calls)`);
    return `Budget ${b.day}: $${b.spent.toFixed(3)} of $${b.cap.toFixed(2)} (${b.pct}%)${b.paused ? ' — cloud paused' : ''}\n${lines.join('\n') || '  no spend yet'}\n/budget <usd> sets today's cap.`;
  }

  nextRun(cron: string, from = new Date(), horizonMin = 8 * 24 * 60): Date | null {
    const d = new Date(from);
    d.setSeconds(0, 0);
    for (let i = 1; i <= horizonMin; i++) {
      d.setMinutes(d.getMinutes() + 1);
      if (cronMatches(cron, d)) return new Date(d);
    }
    return null;
  }

  agentStats(id: string, days = 7) {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const q = (sql: string, ...a: any[]) => this.db.prepare(sql).get(...a) as any;
    const tasks = this.db.prepare('SELECT state, COUNT(*) n FROM tasks WHERE agent_id = ? AND created_at >= ? GROUP BY state').all(id, since) as { state: string; n: number }[];
    const dec = this.db.prepare('SELECT status, COUNT(*) n FROM decisions WHERE agent_id = ? AND created_at >= ? GROUP BY status').all(id, since) as { status: string; n: number }[];
    const cost = q('SELECT COALESCE(SUM(usd),0) s FROM costs WHERE agent_id = ? AND ts >= ?', id, since).s as number;
    const recent = this.db.prepare("SELECT id, objective, state, substr(COALESCE(result, error, ''), 1, 160) r FROM tasks WHERE agent_id = ? AND created_at >= ? AND kind != 'retro' ORDER BY id DESC LIMIT 6").all(id, since) as any[];
    const by = (rows: { n: number }[], k: string, v: string) => rows.find((r: any) => r[k] === v)?.n ?? 0;
    const s = {
      agent: id,
      days,
      done: by(tasks, 'state', 'done'),
      failed: by(tasks, 'state', 'failed'),
      approved: by(dec, 'status', 'approved'),
      rejected: by(dec, 'status', 'rejected'),
      edited: by(dec, 'status', 'edit_requested'),
      pending: by(dec, 'status', 'pending') + by(dec, 'status', 'stale'),
      cost: Math.round(cost * 1000) / 1000,
      recent,
      text: '',
    };
    s.text = `Agent ${id}, last ${days} days: ${s.done} tasks done, ${s.failed} failed. Decisions: ${s.approved} approved, ${s.rejected} rejected, ${s.edited} edited, ${s.pending} pending. Spend $${s.cost.toFixed(3)}.
Engagement/replies/visits/conversions: not available yet (adapters are ${this.settings.adapterMode.toUpperCase()}; no live metrics).
Recent:
${recent.map((r) => `- #${r.id} [${r.state}] ${r.objective.slice(0, 80)} → ${r.r.replace(/\n/g, ' ')}`).join('\n') || '- none'}`;
    return s;
  }

  digestText(day = today()): string {
    const rows = this.db
      .prepare("SELECT agent_id, state, COUNT(*) n FROM tasks WHERE substr(created_at,1,10) = ? OR substr(finished_at,1,10) = ? GROUP BY agent_id, state")
      .all(day, day) as { agent_id: string | null; state: string; n: number }[];
    const lines: string[] = [`🗞 Ren 2 daily digest — ${day}`];
    for (const a of this.agents.list()) {
      const mine = rows.filter((r) => r.agent_id === a.id);
      const last = this.db.prepare("SELECT result FROM tasks WHERE agent_id = ? AND state = 'done' AND kind NOT IN ('retro') ORDER BY id DESC LIMIT 1").get(a.id) as { result: string } | undefined;
      const n = (s: string) => mine.find((r) => r.state === s)?.n ?? 0;
      lines.push(`\n${a.name} [${this.agents.status(a.id)}]: ${n('done')} done, ${n('failed')} failed, ${n('needs_decision')} waiting${last ? `\n  latest: ${last.result.split('\n').find((l) => l.trim())?.slice(0, 160)}` : ''}`);
    }
    const chatN = rows.filter((r) => !r.agent_id).reduce((s, r) => s + r.n, 0);
    lines.push(`\nChat/other tasks: ${chatN}`);
    const pv = this.db.prepare("SELECT agent_id, version, reason FROM playbook_versions WHERE substr(created_at,1,10) >= ? AND version > 1 ORDER BY id DESC").all(new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)) as any[];
    if (pv.length) lines.push(`\nPlaybook changes this week:\n${pv.map((p) => `  ${p.agent_id} v${p.version}: ${p.reason}`).join('\n')}`);
    const b = this.budget.summary();
    lines.push(`\nSpend: $${b.spent.toFixed(3)} of $${b.cap.toFixed(2)}`);
    const open = this.gate.open();
    lines.push(`Decisions waiting on you: ${open.length}${open.length ? ` (${open.slice(0, 3).map((d) => '#' + d.id).join(', ')}…)` : ''}`);
    const next = this.agents
      .list()
      .filter((a) => a.schedule && this.agents.status(a.id) === 'running')
      .map((a) => ({ a, at: this.nextRun(a.schedule!) }))
      .filter((x) => x.at)
      .sort((x, y) => x.at!.getTime() - y.at!.getTime())
      .slice(0, 4);
    lines.push(`Next: ${next.map((x) => `${x.a.id} ${x.at!.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`).join(' · ') || 'nothing scheduled'}`);
    return lines.join('\n');
  }
}
