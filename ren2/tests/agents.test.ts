// Agents (config, scheduler, playbooks, retro, digest) + the five built-in agents end to end
// against mock adapters and a fake model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCore, runToEnd } from './helpers.js';
import { validateAgent } from '../src/agents/agents.js';

test('agent configs load and validate', () => {
  const { core } = makeCore();
  assert.deepEqual(core.agents.list().map((a) => a.id).sort(), ['content', 'ops', 'outreach', 'research', 'sites']);
  assert.deepEqual(core.agents.errors, {});
  assert.ok(validateAgent({ id: 'Bad Id', name: 'x', mission: 'y', schedule: 'nope' }).length >= 2);
});

test('create + edit agent config; id change refused', () => {
  const { core } = makeCore();
  const a = core.agents.writeConfig(null, 'id: scout\nname: Scout\nmission: Look around\nschedule: "0 9 * * *"\n');
  assert.equal(a.id, 'scout');
  assert.ok(fs.existsSync(path.join(core.agents.dir, 'scout.yaml')));
  assert.throws(() => core.agents.writeConfig(null, 'id: scout\nname: S\nmission: m\n'), /already exists/);
  assert.throws(() => core.agents.writeConfig('scout', 'id: other\nname: S\nmission: m\n'), /id/);
  assert.equal(core.agents.writeConfig('scout', 'id: scout\nname: Scout 2\nmission: m\n').name, 'Scout 2');
});

test('scheduler fires once per matching minute, respects pause and schedule_paused', () => {
  const { core } = makeCore();
  const at6 = new Date(2026, 10, 27, 6, 0);
  const first = core.agents.schedule(at6).map((t) => t.agent_id);
  assert.ok(core.tasks.list().some((t) => t.job_id === 'storefront-scan'), 'job id recorded');
  assert.ok(first.includes('research'));
  assert.ok(first.includes('ops'));
  assert.equal(core.agents.schedule(at6).length, 0, 'same slot never fires twice');
  core.agents.setStatus('ops', 'paused');
  core.agents.pauseSchedule('research', true);
  const at630 = new Date(2026, 10, 27, 6, 30);
  assert.ok(!core.agents.schedule(at630).some((t) => t.agent_id === 'ops'));
});

test('playbook: apply new version, revert with one call', () => {
  const { core } = makeCore();
  const v1 = core.agents.playbook('research');
  const v = core.agents.applyPlaybook('research', '- new practice', 'test');
  assert.equal(v, 2);
  assert.equal(core.agents.playbook('research'), '- new practice');
  core.agents.revertPlaybook('research', 1);
  assert.equal(core.agents.playbook('research'), v1);
});

test('ops agent: health + adapters + queue → report, no model needed', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'Ops check', agentId: 'ops', kind: 'agent', source: 'schedule' });
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.match(done.result!, /Ops check/);
  assert.match(done.result!, /Storefront: mock/);
  await core.stop();
});

test('research agent: storefront scan → memory lesson → handoff to content', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = (i: any) => (i.prompt.includes('Why is the store') ? '## Findings\n- 86% mobile, account required at checkout (MOCK data)\n## Proposed changes\n1. Guest checkout\n## For Content\nShow shipping upfront' : 'x');
  const t = core.tasks.create({ objective: core.agents.get('research')!.jobs[0].do, agentId: 'research', kind: 'agent', project: 'storefront', source: 'schedule' });
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.match(done.result!, /Guest checkout/);
  assert.ok(core.memory.search('guest checkout', { project: 'storefront' }).some((m) => m.kind === 'lesson'));
  const asked = core.messages.outbox('research').find((m) => m.kind === 'request');
  assert.equal(asked?.to_agent, 'content');
  assert.ok(core.messages.outbox('research').some((m) => m.to_agent === '*' && m.kind === 'fyi'), 'shared with the team');
  core.workLoop();
  const handoff = core.tasks.list().find((x) => x.parent_id === t.id);
  assert.equal(handoff?.agent_id, 'content', 'content picked the request up by itself');
  // The storefront step really used MOCK fixture numbers
  assert.match(core.tasks.steps(t.id)[0].output!, /\[MOCK\].*1012 visits/);
  await core.stop();
});

test('content agent: draft → script → Showrunner job → publish gate', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = (i: any) => (i.prompt.includes('video script') ? 'HOOK: ... BEAT 1 ...' : 'Shipping shown upfront now. No surprises at checkout.');
  const t = core.tasks.create({ objective: 'Draft posts from research', agentId: 'content', kind: 'agent', project: 'storefront' });
  const parked = await runToEnd(core, t.id);
  assert.equal(parked.state, 'needs_decision', parked.error || '');
  assert.match(core.tasks.steps(t.id)[4].output!, /queued Showrunner job/);
  core.decide(core.gate.open()[0].id, 'approve');
  assert.equal((await runToEnd(core, t.id, ['done', 'failed'])).state, 'done');
  await core.stop();
});

test('sites agent: spec → real local preview → gated go-live', async () => {
  const { core, providers, s } = makeCore();
  (providers.anthropic as any).reply = () => JSON.stringify({ name: 'starter-kit', title: 'Starter Kit', headline: 'Get started', subhead: 'Everything you need', sections: [{ heading: 'What', body: 'A kit' }], cta: { label: 'Buy', href: '#contact' } });
  const t = core.tasks.create({ objective: 'make a site for the Starter Kit', agentId: 'sites', kind: 'agent' });
  const parked = await runToEnd(core, t.id);
  assert.equal(parked.state, 'needs_decision', parked.error || '');
  const d = core.gate.open()[0];
  assert.equal(d.action_type, 'deploy:public');
  assert.match(d.preview!, /\/previews\/starter-kit-/);
  const dirs = fs.readdirSync(path.join(s.workspace, 'previews'));
  assert.match(fs.readFileSync(path.join(s.workspace, 'previews', dirs[0], 'index.html'), 'utf8'), /Get started/);
  core.decide(d.id, 'approve');
  const done = await runToEnd(core, t.id, ['done', 'failed']);
  assert.match(done.result!, /nothing was deployed/);
  await core.stop();
});

test('outreach agent: prospects → drafts in BGE → one contact decision for the batch', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = () => JSON.stringify([{ prospect_id: 'pr1', subject: 'Online booking', body: 'Hi…' }, { prospect_id: 'pr2', subject: 'Quote form', body: 'Hi…' }]);
  const t = core.tasks.create({ objective: 'Draft outreach', agentId: 'outreach', kind: 'agent' });
  const parked = await runToEnd(core, t.id);
  assert.equal(parked.state, 'needs_decision', parked.error || '');
  const open = core.gate.open();
  assert.equal(open.length, 1);
  assert.equal(open[0].gate, 'contact');
  assert.match(open[0].preview!, /Online booking/);
  core.decide(open[0].id, 'approve');
  const done = await runToEnd(core, t.id, ['done', 'failed']);
  assert.match(done.result!, /no email left this machine/);
  await core.stop();
});

test('weekly retro proposes + auto-applies a playbook version; digest summarises', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = () => '- Lead with the biggest funnel drop\n- Cite evidence\nREASON: sharper focus on the checkout drop';
  const created = core.agents.schedule(new Date(2026, 10, 30, 7, 0)); // Monday 07:00 → retro for all
  const retro = created.find((t) => t.kind === 'retro' && t.agent_id === 'research')!;
  const done = await runToEnd(core, retro.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.equal(core.agents.playbookVersions('research').length, 2);
  assert.match(core.agents.playbook('research'), /biggest funnel drop/);
  const digest = core.digestText();
  assert.match(digest, /daily digest/);
  assert.match(digest, /research v2: sharper focus/);
  await core.stop();
});
