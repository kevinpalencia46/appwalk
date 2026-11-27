// Runner: picks runnable tasks, plans, executes steps, verifies, reports. Resumes
// mid-flight tasks after a restart from their last completed step. Honors the kill
// switch (halts everything immediately) and parks gated steps in needs_decision.
import type { Core } from '../core.js';
import { TaskRow, StepRow, StepPlan } from './store.js';
import { planTask } from './planner.js';
import { NeedsDecision, Rejected } from '../gate/gate.js';
import { kvGet, kvSet, DB } from '../db.js';
import { emit, log, redact } from '../log.js';
import { nowIso } from '../env.js';

const OUT_CAP = 24_000;

function dig(o: any, p: string[]): any {
  return p.reduce((a, k) => (a == null ? undefined : a[k]), o);
}

/** Fill {{step.N}}, {{data.N.path}} and {{var}} placeholders. A string that is exactly one
 *  {{data…}} placeholder becomes the raw value (arrays/objects pass through intact). */
export function render(v: any, outputs: (string | null)[], vars: Record<string, string>, datas: any[] = []): any {
  if (typeof v === 'string') {
    const whole = v.match(/^\{\{data\.(\d+)((?:\.\w+)*)\}\}$/);
    if (whole) return dig(datas[Number(whole[1])], whole[2].split('.').filter(Boolean)) ?? null;
    return v
      .replace(/\{\{step\.(\d+)\}\}/g, (_, n) => outputs[Number(n)] ?? '')
      .replace(/\{\{data\.(\d+)((?:\.\w+)*)\}\}/g, (_, n, p) => {
        const x = dig(datas[Number(n)], p.split('.').filter(Boolean));
        return x == null ? '' : typeof x === 'string' ? x : JSON.stringify(x);
      })
      .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  }
  if (Array.isArray(v)) return v.map((x) => render(x, outputs, vars, datas));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, render(x, outputs, vars, datas)]));
  return v;
}

const REVISABLE = ['text', 'body', 'message', 'copy', 'messages'];

export class Failures {
  constructor(private db: DB) {}
  get(sig: string) {
    return this.db.prepare('SELECT * FROM failures WHERE signature = ?').get(sig) as
      | { signature: string; count: number; last_error: string; agent_id: string | null; item_task_id: number | null; notified: number }
      | undefined;
  }
  /** Returns the new count. */
  record(sig: string, agentId: string | null, error: string): number {
    this.db
      .prepare(
        `INSERT INTO failures (signature, count, last_error, agent_id, updated_at) VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(signature) DO UPDATE SET count = count + 1, last_error = excluded.last_error, updated_at = excluded.updated_at`,
      )
      .run(sig, error.slice(0, 2000), agentId, nowIso());
    return this.get(sig)!.count;
  }
  markNotified(sig: string, itemTaskId: number) {
    this.db.prepare('UPDATE failures SET notified = 1, item_task_id = ? WHERE signature = ?').run(itemTaskId, sig);
  }
  reset(sig: string) {
    this.db.prepare('DELETE FROM failures WHERE signature = ?').run(sig);
  }
  recurring() {
    return this.db.prepare('SELECT * FROM failures WHERE notified = 1 ORDER BY updated_at DESC').all();
  }
}

export class Runner {
  active = new Map<number, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  failures: Failures;
  constructor(private core: Core) {
    this.failures = new Failures(core.db);
  }

  halted(): boolean {
    return kvGet(this.core.db, 'halted') === '1';
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.core.settings.tickMs);
    this.tick();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const ac of this.active.values()) ac.abort();
    const until = Date.now() + 5000;
    while (this.active.size && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  }

  /** Kill switch: halt all agents and in-flight tasks immediately. */
  kill(by = 'dashboard'): void {
    kvSet(this.core.db, 'halted', '1');
    for (const ac of this.active.values()) ac.abort(new Error('halted'));
    log('warn', `KILL SWITCH by ${by}`);
    emit('halted', { halted: true, by });
  }
  resume(by = 'dashboard'): void {
    kvSet(this.core.db, 'halted', '0');
    log('info', `resumed by ${by}`);
    emit('halted', { halted: false, by });
    this.tick();
  }

  tick(): void {
    if (this.halted()) return;
    const free = this.core.settings.maxConcurrentTasks - this.active.size;
    if (free <= 0) return;
    const candidates = this.core.tasks.runnable(free + 20, [...this.active.keys()]);
    let started = 0;
    for (const t of candidates) {
      if (started >= free) break;
      if (t.agent_id && this.core.agents.status(t.agent_id) !== 'running') continue; // paused/stopped agents wait
      started++;
      void this.run(t);
    }
  }

  async run(task: TaskRow): Promise<void> {
    const core = this.core;
    if (this.active.has(task.id)) return;
    const ac = new AbortController();
    this.active.set(task.id, ac);
    const agent = task.agent_id ? core.agents.get(task.agent_id) ?? null : null;
    try {
      if (!task.plan) {
        core.tasks.setState(task.id, 'planning');
        const plan = await planTask(core, task, agent, ac.signal);
        if (ac.signal.aborted) throw ac.signal.reason ?? new Error('aborted');
        core.tasks.setPlan(task.id, plan);
      }
      task = core.tasks.setState(task.id, 'running');
      if (agent) core.agents.recordRun(agent.id, task.id);
      const steps = core.tasks.steps(task.id);
      const outputs: (string | null)[] = steps.map((s) => (s.status === 'done' || s.status === 'skipped' ? s.output : null));
      const datas: any[] = steps.map((s) => (s.data ? JSON.parse(s.data) : null));
      const vars = {
        objective: task.objective,
        project: task.project || '',
        task_id: String(task.id),
        playbook: agent ? core.agents.playbook(agent.id) : '',
        skills: agent ? core.skills.text(agent.skills) || '(none)' : '',
        inbox: agent ? core.messages.context(agent.id) || '(nothing new)' : '',
      };

      for (const step of steps) {
        if (step.status === 'done' || step.status === 'skipped') continue;
        if (ac.signal.aborted || this.halted()) throw new Error('halted');
        const r = await this.runStep(task, step, outputs, datas, vars, agent, ac.signal);
        if (r === 'parked' || r === 'rejected') return;
        outputs[step.idx] = r.out;
        datas[step.idx] = r.data ?? null;
      }

      core.tasks.setState(task.id, 'verifying');
      const final = core.tasks.steps(task.id);
      const failed = final.filter((s) => s.status === 'failed' && !JSON.parse(s.args).optional);
      const resultStep = [...final].reverse().find((s) => JSON.parse(s.args).result) || [...final].reverse().find((s) => s.status === 'done');
      const result = (resultStep?.output || '').trim();
      if (failed.length) throw new Error(`verify: ${failed.length} step(s) failed`);
      if (!result) throw new Error('verify: the task produced no result');
      const cost = core.budget.taskCost(task.id);
      const report = `${final.filter((s) => s.status === 'done').length}/${final.length} steps · $${cost.toFixed(4)}${task.agent_id ? ` · ${task.agent_id}` : ''}\n${result.slice(0, 280)}`;
      const done = core.tasks.setState(task.id, 'done', { result, report });
      if (task.signature) this.failures.reset(task.signature);
      await core.onTaskFinished(done);
    } catch (e: any) {
      if (ac.signal.aborted || this.halted() || String(e?.message) === 'halted') {
        // Halted or shutting down: leave it resumable from its last completed step.
        const cur = core.tasks.get(task.id);
        if (cur && !['done', 'failed', 'needs_decision'].includes(cur.state)) core.tasks.setState(task.id, 'queued');
        return;
      }
      const msg = redact(String(e?.message || e)).slice(0, 2000);
      log('warn', `task ${task.id} failed`, msg.slice(0, 300));
      const failedRow = core.tasks.setState(task.id, 'failed', { error: msg, report: `failed: ${msg.slice(0, 240)}` });
      await this.onFailure(failedRow, msg);
      await core.onTaskFinished(failedRow);
    } finally {
      this.active.delete(task.id);
    }
  }

  private async runStep(task: TaskRow, step: StepRow, outputs: (string | null)[], datas: any[], vars: Record<string, string>, agent: any, signal: AbortSignal): Promise<{ out: string; data?: unknown } | 'parked' | 'rejected'> {
    const core = this.core;
    const tool = core.tools.get(step.tool);
    const rawArgs = JSON.parse(step.args);
    let args = render(rawArgs, outputs, vars, datas);
    let revised = false;

    // Kevin pressed Edit: revise the draft, then ask again.
    const last = core.gate.latestFor(task.id, step.idx);
    if (last?.status === 'edit_requested') {
      args = await this.revise(task, args, last.response || '', signal);
      core.tasks.updateStepArgs(task.id, step.idx, args);
      revised = true;
    }

    core.tasks.stepStart(task.id, step.idx);
    try {
      if (!tool) throw new Error(`unknown tool ${step.tool}`);
      if (agent && task.kind !== 'retro' && !core.agents.canUse(agent, step.tool)) throw new Error(`${agent.id} has no access to the ${step.tool} tool — add it under tools: in agents/${agent.id}.yaml`);
      let firstGate = true;
      const res = await tool.run(args, {
        core,
        task,
        stepIdx: step.idx,
        agent,
        signal,
        key: `t${task.id}s${step.idx}`,
        gate: (g) => {
          const r = core.gate.require({ ...g, taskId: task.id, stepIdx: step.idx, agentId: task.agent_id }, revised && firstGate);
          firstGate = false;
          return r;
        },
      });
      const out = redact(res.output).slice(0, OUT_CAP);
      core.tasks.stepEnd(task.id, step.idx, 'done', out, res.data);
      return { out, data: res.data };
    } catch (e: any) {
      if (e instanceof NeedsDecision) {
        core.tasks.stepReset(task.id, step.idx);
        core.tasks.setState(task.id, 'needs_decision', { report: `waiting for decision #${e.decisionId}` });
        return 'parked';
      }
      if (e instanceof Rejected) {
        core.tasks.stepEnd(task.id, step.idx, 'skipped', `Kevin rejected this${e.note ? `: ${e.note}` : ''}`);
        const done = core.tasks.setState(task.id, 'done', { result: `Stopped at step ${step.idx + 1}: Kevin rejected it${e.note ? ` (${e.note})` : ''}.`, report: 'rejected by Kevin' });
        await core.onTaskFinished(done);
        return 'rejected';
      }
      if (signal.aborted || this.halted()) {
        core.tasks.stepReset(task.id, step.idx);
        throw new Error('halted');
      }
      const msg = redact(String(e?.message || e)).slice(0, 4000);
      core.tasks.stepEnd(task.id, step.idx, 'failed', msg);
      if (rawArgs.optional) return { out: `(optional step failed: ${msg.slice(0, 300)})` };
      throw new Error(`step ${step.idx + 1} (${step.tool}) failed: ${msg}`);
    }
  }

  private async revise(task: TaskRow, args: Record<string, any>, instructions: string, signal: AbortSignal): Promise<Record<string, any>> {
    const out: Record<string, any> = { ...args, revision_note: instructions };
    for (const k of REVISABLE) {
      if (args[k] === undefined) continue;
      const draft = typeof args[k] === 'string' ? args[k] : JSON.stringify(args[k], null, 1);
      const r = await this.core.router.complete({
        kind: 'write',
        prompt: `Revise this draft following Kevin's instructions.\n\nInstructions: ${instructions}\n\nDraft:\n${draft}\n\nReturn only the revised ${typeof args[k] === 'string' ? 'text' : 'JSON (same shape)'}.`,
        agentId: task.agent_id,
        taskId: task.id,
        signal,
      });
      out[k] = typeof args[k] === 'string' ? r.text : JSON.parse(r.text.match(/[\[{][\s\S]*[\]}]/)?.[0] || 'null') ?? args[k];
    }
    return out;
  }

  /** Same signature failing 3×: one recurring-failure item + diagnosis, pause schedule, notify once. */
  private async onFailure(task: TaskRow, msg: string): Promise<void> {
    if (!task.signature || task.kind === 'diagnosis') return;
    const count = this.failures.record(task.signature, task.agent_id, msg);
    const f = this.failures.get(task.signature)!;
    if (count < 3 || f.notified) return;
    const recent = this.core.db
      .prepare("SELECT id, error FROM tasks WHERE signature = ? AND state = 'failed' ORDER BY id DESC LIMIT 3")
      .all(task.signature) as { id: number; error: string }[];
    const errors = recent.map((r) => `#${r.id}: ${r.error}`).join('\n\n');
    const plan: StepPlan[] = [
      {
        tool: 'think',
        args: {
          kind: 'cheap-summarize',
          prompt: `The same Ren 2 task failed 3 times.\nTask: ${task.objective}\nAgent: ${task.agent_id || 'chat'}\n\nErrors:\n${errors}\n\nGive a one-paragraph diagnosis (most likely cause) and the single next step to fix it.`,
          fallback: 'extractive',
          material: errors,
        },
      },
    ];
    const item = this.core.tasks.create({ objective: `Recurring failure: ${task.objective.slice(0, 120)}`, kind: 'diagnosis', agentId: null, project: task.project, source: 'ren2', parentId: task.id, plan });
    this.failures.markNotified(task.signature, item.id);
    if (task.agent_id) this.core.agents.pauseSchedule(task.agent_id, true);
    this.core.alert('error', `Recurring failure (3×): ${task.objective.slice(0, 100)}${task.agent_id ? ` — ${task.agent_id} schedule paused` : ''}`, `failure:${task.signature}`);
    emit('failure.recurring', { signature: task.signature, taskId: task.id, itemTaskId: item.id, agentId: task.agent_id, error: msg.slice(0, 300) });
  }

  /** Retry a failed task (or a recurring-failure item's original task). */
  retry(id: number): TaskRow {
    const t = this.core.tasks.get(id);
    if (!t) throw new Error(`no task ${id}`);
    let target = t;
    if (t.kind === 'diagnosis' && t.parent_id) {
      target = this.core.tasks.get(t.parent_id) || t;
      this.core.tasks.dismiss(t.id);
    }
    if (target.signature) {
      this.failures.reset(target.signature);
      if (target.agent_id) this.core.agents.pauseSchedule(target.agent_id, false);
    }
    for (const s of this.core.tasks.steps(target.id)) if (s.status === 'failed' || s.status === 'running') this.core.tasks.stepReset(target.id, s.idx);
    const out = this.core.tasks.requeue(target.id);
    this.tick();
    return out;
  }
}
