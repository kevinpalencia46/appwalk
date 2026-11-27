// Desks: autonomy from the inbox, request → reply loop between agents, Kevin assigning work,
// project access + tool access enforcement, skills in prompts, job runs, desk endpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { makeCore, runToEnd, tmpdir } from './helpers.js';
import { createServer } from '../src/server.js';
import { Skills, parseSkill } from '../src/agents/skills.js';
import { ROOT } from '../src/env.js';

test('Kevin assigns work → agent picks it up by itself → reply lands back with the result', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = (i: any) => (i.prompt.includes('JSON array') ? '[{"tool":"think","args":{"kind":"chat","prompt":"Answer: {{objective}}"}}]' : 'Competitors show shipping upfront.');
  const m = core.assign('research', 'Check how competitors show shipping', 'Two or three examples');
  const t = core.tasks.list().find((x) => x.agent_id === 'research')!;
  assert.ok(t, 'work loop created a task immediately');
  assert.equal(core.messages.get(m.id)!.status, 'in_progress');
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.equal(core.messages.get(m.id)!.status, 'done');
  const reply = core.messages.inbox('kevin').find((x) => x.kind === 'reply');
  assert.match(reply!.body, /shipping upfront/);
  assert.equal(reply!.reply_to, m.id);
  await core.stop();
});

test('one thing at a time per desk; next request starts when the desk frees up', async () => {
  const { core } = makeCore();
  core.messages.send({ from: 'kevin', to: 'research', kind: 'request', subject: 'first' });
  core.messages.send({ from: 'kevin', to: 'research', kind: 'request', subject: 'second' });
  core.workLoop();
  assert.equal(core.tasks.list().filter((t) => t.agent_id === 'research').length, 1, 'only one in flight');
  core.agents.setStatus('research', 'paused');
  assert.equal(core.workLoop().length, 0);
  await core.stop();
});

test('agents ask each other: research → content request, content replies to research', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = (i: any) => (i.prompt.includes('Why is the store') ? '## Findings\n- shipping hidden\n## Proposed changes\n1. show shipping\n## For Content\nshipping upfront' : 'Shipping is now shown upfront.');
  const r = core.tasks.create({ objective: core.agents.get('research')!.jobs[0].do, agentId: 'research', kind: 'agent', project: 'storefront', source: 'schedule' });
  assert.equal((await runToEnd(core, r.id)).state, 'done');
  core.workLoop();
  const c = core.tasks.list().find((x) => x.agent_id === 'content')!;
  assert.equal(c.parent_id, r.id);
  assert.match(c.objective, /Draft posts from research/);
  // Content's prompt saw Research's team note
  const parked = await runToEnd(core, c.id);
  assert.equal(parked.state, 'needs_decision');
  const writePrompt = (providers.anthropic as any).calls.map((x: any) => x.prompt).find((p: string) => p.includes('Write ONE social post'));
  assert.match(writePrompt, /From research \(team\)/, 'team board context reached Content');
  assert.match(writePrompt, /Skill: Social post/, 'skills reached the prompt');
  core.decide(core.gate.open()[0].id, 'approve');
  await runToEnd(core, c.id, ['done']);
  const reply = core.messages.inbox('research').find((m) => m.kind === 'reply' && m.from_agent === 'content');
  assert.ok(reply, 'content replied to research');
  await core.stop();
});

test('project access is enforced per agent and method', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'sneaky', agentId: 'research', kind: 'agent', plan: [{ tool: 'adapter', args: { adapter: 'bge', method: 'send_drafts', draft_ids: [] } }] });
  const f = await runToEnd(core, t.id);
  assert.equal(f.state, 'failed');
  assert.match(f.error!, /no access to Growth Engine\.send_drafts/);
  const ok = core.tasks.create({ objective: 'read', agentId: 'research', kind: 'agent', plan: [{ tool: 'adapter', args: { adapter: 'storefront', method: 'summary' } }] });
  assert.equal((await runToEnd(core, ok.id)).state, 'done', '"read" grants read methods');
  const t2 = core.tasks.create({ objective: 'shell', agentId: 'content', kind: 'agent', plan: [{ tool: 'shell', args: { cmd: 'echo hi' } }] });
  assert.match((await runToEnd(core, t2.id)).error!, /no access to the shell tool/);
  assert.equal(core.agents.canCall(core.agents.get('ops')!, 'trading', 'paper_results', 'read'), true);
  assert.equal(core.agents.canCall(core.agents.get('sites')!, 'bge', 'leads', 'read'), false);
  await core.stop();
});

test('skills load from markdown and every configured skill exists', () => {
  const s = new Skills(path.join(ROOT, 'skills'));
  assert.ok(s.list().length >= 7);
  const { core } = makeCore();
  for (const a of core.agents.list()) for (const id of a.skills) assert.ok(s.get(id), `${a.id} skill ${id} exists`);
  assert.deepEqual(parseSkill('---\nname: X\nprojects: [a, b]\n---\nbody', 'x', 'f').projects, ['a', 'b']);
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'k.md'), '---\nname: K\n---\nold');
  const ks = new Skills(dir);
  assert.equal(ks.save('k', 'new body').body, 'new body');
  assert.match(fs.readFileSync(path.join(dir, 'k.md'), 'utf8'), /name: K/);
});

test('desk + jobs endpoints', async () => {
  const { core } = makeCore();
  const srv = createServer(core);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const j = async (m: string, p: string, body?: any) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(r.status, 200, `${m} ${p}`);
    return r.json() as Promise<any>;
  };
  const all = await j('GET', '/api/desks');
  assert.equal(all.desks.length, 5);
  assert.ok(all.desks.find((d: any) => d.id === 'research').jobs[0].nextRun);
  const job = await j('POST', '/api/agents/ops/jobs/health-check/run');
  assert.equal(job.job_id, 'health-check');
  await runToEnd(core, job.id);
  const desk = await j('GET', '/api/desks/ops');
  assert.equal(desk.recent[0].id, job.id);
  assert.ok(desk.skills.some((s: any) => s.id === 'pi-health'));
  const m = await j('POST', '/api/agents/sites/assign', { subject: 'Make a site for the Refill Pack' });
  assert.equal(m.to_agent, 'sites');
  assert.ok(core.tasks.list().some((t) => t.agent_id === 'sites' && t.objective === 'Make a site for the Refill Pack' && t.message_id === m.id), 'request became a task on the desk');
  assert.ok((await j('GET', '/api/messages')).length >= 1);
  assert.ok((await j('GET', '/api/messages?agent=sites')).some((x: any) => x.id === m.id));
  await j('POST', '/api/agents/sites/inbox/read');
  const skills = await j('GET', '/api/skills');
  assert.ok(skills.find((s: any) => s.id === 'landing-page').agents.includes('sites'));
  assert.equal((await j('GET', '/api/skills/landing-page')).name, 'Landing page');
  assert.equal((await fetch(base + '/api/agents/sites/assign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await fetch(base + '/api/desks/nobody')).status, 404);
  const created = await j('POST', '/api/agents', { id: 'pricer', name: 'Pricer', mission: 'Watch prices', access: 'storefront', tools: 'adapter', skills: 'storefront-funnel', job: 'Check prices', schedule: '0 9 * * 1' });
  assert.deepEqual(created.access, { storefront: ['read'] });
  assert.equal(created.jobs[0].every, '0 9 * * 1');
  srv.close();
  await core.stop();
});

test('skill PUT writes the file (temp skills dir)', async () => {
  const dir = tmpdir();
  fs.cpSync(path.join(ROOT, 'skills'), dir, { recursive: true });
  const { core } = makeCore({ settings: { skillsDir: dir } });
  const srv = createServer(core);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const r = await fetch(base + '/api/skills/landing-page', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: '- Always show price.' }) });
  assert.equal(r.status, 200);
  assert.match(fs.readFileSync(path.join(dir, 'landing-page.md'), 'utf8'), /Always show price/);
  srv.close();
  await core.stop();
});
