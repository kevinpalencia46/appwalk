// Runner: plan → steps → verify, restart-resume, gates (approve/reject/edit/always),
// kill switch, recurring failures, retry, render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCore, runToEnd, waitFor, fake, off } from './helpers.js';
import { render } from '../src/tasks/runner.js';
import { parsePlanJson, detectProject, directPlan } from '../src/tasks/planner.js';
import { Core } from '../src/core.js';
import { bus } from '../src/log.js';

test('render fills step outputs, data paths and vars', () => {
  const out = render({ a: '{{step.0}}!', b: '{{data.1.ids}}', c: 'id={{data.1.ids}}', d: '{{objective}}' }, ['hello', 'x'], { objective: 'obj' }, [null, { ids: [1, 2] }]);
  assert.deepEqual(out, { a: 'hello!', b: [1, 2], c: 'id=[1,2]', d: 'obj' });
});

test('planner helpers', () => {
  assert.equal(detectProject('summarize what is in memory about Storefront'), 'storefront');
  assert.equal(directPlan('x', null).length, 2);
  assert.throws(() => parsePlanJson('[{"tool":"nope"}]', ['think']));
  assert.equal(parsePlanJson('sure: [{"tool":"think","args":{"prompt":"x"}}]', ['think'])[0].tool, 'think');
});

test('chat task: memory → answer, done with result and cost', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = (i: any) => (i.prompt.includes('1,000 visits') ? 'Storefront: ~1,000 visits, 0 orders (#1).' : 'no');
  const t = core.chat('dashboard', 'summarize what is in memory about Storefront');
  core.memory.indexNotes();
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done');
  assert.match(done.result!, /1,000 visits/);
  assert.ok(core.budget.taskCost(t.id) > 0);
  assert.equal(core.chatHistory().at(-1).role, 'ren');
  await core.stop();
});

test('no model at all: labelled extractive answer, not a fake AI summary', async () => {
  const { core } = makeCore({ providers: { anthropic: off('anthropic'), deepseek: off('deepseek'), kimi: off('kimi'), ollama: off('ollama'), claude_code: off('claude_code') } });
  core.memory.indexNotes();
  const t = core.chat('dashboard', 'what do we know about storefront orders?');
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done');
  assert.match(done.result!, /No model available/);
  await core.stop();
});

test('restart resume: completed steps are not re-run', async () => {
  const { core, dir, s } = makeCore();
  const marker = path.join(s.workspace, 'count.txt');
  const plan = [
    { tool: 'shell', args: { cmd: `echo run >> ${marker}` } },
    { tool: 'shell', args: { cmd: 'sleep 1; echo second' } },
    { tool: 'system', args: { action: 'echo', text: 'finished {{step.1}}' } },
  ];
  const t = core.tasks.create({ objective: 'resume test', plan });
  core.runner.tick();
  await waitFor(() => core.tasks.steps(t.id)[1].status === 'running', 5000, 'step 2 running');
  // Simulate a crash: stop without letting the task finish, then reopen a new Core on the same DB.
  await core.runner.stop();
  core.db.close();
  const core2 = new Core(s, { providers: { anthropic: fake('anthropic', true), deepseek: off('deepseek'), kimi: off('kimi'), ollama: fake('ollama', false), claude_code: off('claude_code') } });
  const done = await runToEnd(core2, t.id);
  assert.equal(done.state, 'done');
  assert.match(done.result!, /finished second/);
  assert.equal(fs.readFileSync(marker, 'utf8').trim().split('\n').length, 1, 'step 1 ran exactly once');
  await core2.stop();
  void dir;
});

function gatedPlan() {
  return [
    { tool: 'publish', args: { action: 'draft', platform: 'drafts', text: 'Hello world post' } },
    { tool: 'publish', args: { action: 'publish', platform: 'drafts', draft_id: '{{data.0.id}}', text: 'Hello world post' } },
  ];
}

test('gate: needs_decision → approve resumes → done', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'post', agentId: 'content', kind: 'agent', plan: gatedPlan() });
  const parked = await runToEnd(core, t.id);
  assert.equal(parked.state, 'needs_decision');
  const [d] = core.gate.open();
  assert.equal(d.gate, 'publish');
  assert.equal(d.action_type, 'post:drafts');
  assert.match(d.preview!, /Hello world/);
  core.decide(d.id, 'approve');
  const done = await runToEnd(core, t.id, ['done', 'failed']);
  assert.equal(done.state, 'done');
  assert.match(done.result!, /nothing was posted/);
  assert.equal(core.drafts.byTask(t.id)!.status, 'approved');
  await core.stop();
});

test('gate: reject ends the task without running the action', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'post', agentId: 'content', kind: 'agent', plan: gatedPlan() });
  await runToEnd(core, t.id);
  core.decide(core.gate.open()[0].id, 'reject', 'not now');
  const done = await runToEnd(core, t.id, ['done', 'failed']);
  assert.equal(done.state, 'done');
  assert.match(done.result!, /rejected/);
  assert.equal(core.drafts.byTask(t.id)!.status, 'draft');
  await core.stop();
});

test('gate: edit revises the draft and asks again', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = () => 'Hello world post — now shorter';
  const t = core.tasks.create({ objective: 'post', agentId: 'content', kind: 'agent', plan: gatedPlan() });
  await runToEnd(core, t.id);
  const first = core.gate.open()[0];
  core.decide(first.id, 'edit', 'make it shorter');
  await runToEnd(core, t.id);
  const second = core.gate.open()[0];
  assert.notEqual(second.id, first.id);
  assert.match(second.preview!, /now shorter/);
  core.decide(second.id, 'approve');
  await runToEnd(core, t.id, ['done']);
  assert.match(core.drafts.byTask(t.id)!.text, /now shorter/);
  await core.stop();
});

test('gate: "always allow" writes the agent auto list; next time no decision', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'post', agentId: 'content', kind: 'agent', plan: gatedPlan() });
  await runToEnd(core, t.id);
  core.decide(core.gate.open()[0].id, 'always');
  await runToEnd(core, t.id, ['done']);
  assert.deepEqual(core.agents.get('content')!.auto, ['post:drafts']);
  assert.match(fs.readFileSync(core.agents.get('content')!.file, 'utf8'), /# drafts = drafts-only/, 'comments preserved');
  const t2 = core.tasks.create({ objective: 'post again', agentId: 'content', kind: 'agent', plan: gatedPlan() });
  assert.equal((await runToEnd(core, t2.id)).state, 'done');
  core.agents.removeAuto('content', 'post:drafts');
  assert.deepEqual(core.agents.get('content')!.auto, []);
  await core.stop();
});

test('stale sweep marks old decisions stale and never approves them', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'post', agentId: 'content', kind: 'agent', plan: gatedPlan() });
  await runToEnd(core, t.id);
  const stale = core.gate.sweepStale(Date.now() + 49 * 3600_000);
  assert.equal(stale.length, 1);
  assert.equal(core.gate.get(stale[0].id)!.status, 'stale');
  assert.equal(core.gate.sweepStale(Date.now() + 99 * 3600_000).length, 0, 'one reminder only');
  core.runner.tick();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(core.tasks.get(t.id)!.state, 'needs_decision');
  await core.stop();
});

test('kill switch halts in-flight work; resume finishes it', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'slow', plan: [{ tool: 'shell', args: { cmd: 'sleep 5; echo late' } }, { tool: 'system', args: { action: 'echo', text: 'after' } }] });
  core.runner.tick();
  await waitFor(() => core.tasks.steps(t.id)[0].status === 'running', 3000, 'running');
  const t0 = Date.now();
  core.runner.kill('test');
  await waitFor(() => !core.runner.active.has(t.id), 2000, 'aborted');
  assert.ok(Date.now() - t0 < 1500, 'halted immediately');
  assert.equal(core.tasks.get(t.id)!.state, 'queued');
  const t2 = core.tasks.create({ objective: 'while halted', plan: [{ tool: 'system', args: { action: 'echo', text: 'x' } }] });
  core.runner.tick();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(core.tasks.get(t2.id)!.state, 'queued', 'nothing starts while halted');
  core.tasks.updateStepArgs(t.id, 0, { cmd: 'echo quick' });
  core.runner.resume('test');
  assert.equal((await runToEnd(core, t.id, ['done'])).state, 'done');
  assert.equal((await runToEnd(core, t2.id, ['done'])).state, 'done');
  await core.stop();
});

test('same failure 3×: one recurring item, schedule paused, notified once; retry clears it', async () => {
  const { core } = makeCore();
  const events: any[] = [];
  const on = (e: any) => e.type === 'failure.recurring' && events.push(e.data);
  bus.on('event', on);
  const plan = [{ tool: 'system', args: { action: 'no-such-action' } }];
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const t = core.tasks.create({ objective: 'Ops check', agentId: 'ops', kind: 'agent', plan });
    ids.push(t.id);
    assert.equal((await runToEnd(core, t.id)).state, 'failed');
  }
  assert.equal(events.length, 1, 'notified once');
  assert.equal(core.agents.state('ops')!.schedule_paused, 1);
  const items = core.tasks.list().filter((t) => t.kind === 'diagnosis');
  assert.equal(items.length, 1);
  await runToEnd(core, items[0].id);
  core.tasks.updateStepArgs(ids[2], 0, { action: 'echo', text: 'fixed' });
  core.runner.retry(items[0].id);
  assert.equal((await runToEnd(core, ids[2], ['done'])).state, 'done');
  assert.equal(core.agents.state('ops')!.schedule_paused, 0);
  assert.equal(core.runner.failures.recurring().length, 0);
  bus.off('event', on);
  await core.stop();
});

test('paused agent tasks wait; archive keeps old tasks', async () => {
  const { core } = makeCore();
  core.agents.setStatus('ops', 'paused');
  const t = core.tasks.create({ objective: 'x', agentId: 'ops', kind: 'agent', plan: [{ tool: 'system', args: { action: 'echo', text: 'hi' } }] });
  core.runner.tick();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(core.tasks.get(t.id)!.state, 'queued');
  core.agents.setStatus('ops', 'running');
  await runToEnd(core, t.id, ['done']);
  core.db.prepare('UPDATE tasks SET finished_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', t.id);
  assert.equal(core.tasks.archiveOld(), 1);
  assert.equal(core.tasks.list().find((x) => x.id === t.id), undefined);
  assert.ok(core.tasks.get(t.id), 'never deleted');
  await core.stop();
});
