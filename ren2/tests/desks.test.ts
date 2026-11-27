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
  const m = core.assign('analyst', 'Compare competitors shipping display', 'Two or three examples');
  const t = core.tasks.list().find((x) => x.agent_id === 'analyst')!;
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

test('a request naming a job runs that job', () => {
  const { core } = makeCore();
  core.messages.send({ from: 'ren', to: 'media', kind: 'request', subject: 'Run analytics-review this morning' });
  const [t] = core.workLoop();
  assert.equal(t.job_id, 'analytics-review');
});

test('one thing at a time per desk; next request starts when the desk frees up', async () => {
  const { core } = makeCore();
  core.messages.send({ from: 'kevin', to: 'analyst', kind: 'request', subject: 'first' });
  core.messages.send({ from: 'kevin', to: 'analyst', kind: 'request', subject: 'second' });
  core.workLoop();
  assert.equal(core.tasks.list().filter((t) => t.agent_id === 'analyst').length, 1, 'only one in flight');
  core.agents.setStatus('analyst', 'paused');
  assert.equal(core.workLoop().length, 0);
  await core.stop();
});

test('project access is enforced per agent and method', async () => {
  const { core } = makeCore();
  const t = core.tasks.create({ objective: 'sneaky', agentId: 'analyst', kind: 'agent', plan: [{ tool: 'adapter', args: { adapter: 'bge', method: 'send_drafts', draft_ids: [] } }] });
  const f = await runToEnd(core, t.id);
  assert.equal(f.state, 'failed');
  assert.match(f.error!, /no access to Growth Engine\.send_drafts/);
  const ok = core.tasks.create({ objective: 'read', agentId: 'analyst', kind: 'agent', plan: [{ tool: 'adapter', args: { adapter: 'storefront', method: 'summary' } }] });
  assert.equal((await runToEnd(core, ok.id)).state, 'done', '"read" grants read methods');
  const t2 = core.tasks.create({ objective: 'shell', agentId: 'media', kind: 'agent', plan: [{ tool: 'shell', args: { cmd: 'echo hi' } }] });
  assert.match((await runToEnd(core, t2.id)).error!, /no access to the shell tool/);
  assert.equal(core.agents.canCall(core.agents.get('ops')!, 'trading', 'paper_results', 'read'), true);
  assert.equal(core.agents.canCall(core.agents.get('sites')!, 'bge', 'leads', 'read'), false);
  assert.equal(core.agents.canCall(core.agents.get('scout')!, 'builder', 'sweep', 'action'), true);
  assert.equal(core.agents.canCall(core.agents.get('scout')!, 'builder', 'create_site', 'action'), false);
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
  assert.equal(all.desks.length, 7);
  assert.ok(all.desks.find((d: any) => d.id === 'analyst').jobs[0].nextRun);
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

test('HQ endpoints: scoreboard, plan now, answer Ren, review verdict', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = () => JSON.stringify({ headline: 'Focus on websites', items: [{ sector: 'websites', agent: 'scout', ask: 'Sweep Vernon' }], questions: ['Which niches for Media?'] });
  const srv = createServer(core);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const j = async (m: string, p: string, body?: any, status = 200) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(r.status, status, `${m} ${p}`);
    return r.json() as Promise<any>;
  };
  const hq0 = await j('GET', '/api/hq');
  assert.deepEqual(hq0.sectors.map((s: any) => s.id), ['media', 'websites', 'storefronts', 'ops']);
  const follow = hq0.sectors[0].goals.find((g: any) => g.metric === 'followers_total');
  assert.equal(follow.mock, true, 'adapter numbers are labelled MOCK');
  assert.equal(hq0.sectors[1].goals.find((g: any) => g.id === 'sweeps').mock, false, "Ren 2's own counts are real");
  assert.equal(hq0.team.length, 6);
  const t = await j('POST', '/api/hq/plan');
  await runToEnd(core, t.id);
  const hq1 = await j('GET', '/api/hq');
  assert.equal(hq1.plan.headline, 'Focus on websites');
  assert.equal(hq1.plan.items[0].agent, 'scout');
  await j('POST', `/api/hq/questions/${hq1.plan.id}/0`, { answer: 'Tech tips and local business stories' });
  assert.ok(core.memory.search('niches', { project: 'ren', kind: 'preference' }).length >= 1, 'answer remembered');
  await j('POST', `/api/hq/questions/${hq1.plan.id}/0`, {}, 400);
  const { openReview } = await import('../src/hq.js');
  const r = openReview(core, { site_id: 's-1', title: 'Demo', ren_notes: 'ok' });
  assert.equal((await j('GET', '/api/reviews')).length, 1);
  await j('POST', `/api/reviews/${r.id}`, { verdict: 'changes' }, 400);
  const out = await j('POST', `/api/reviews/${r.id}`, { verdict: 'changes', change: 'bigger phone number' });
  assert.equal(out.status, 'changes_requested');
  assert.ok((await j('GET', '/api/hq')).reviews.every((x: any) => x.id !== r.id), 'resolved review leaves Needs you');
  await j('POST', `/api/reviews/${r.id}`, { verdict: 'approve' }, 400);
  srv.close();
  await core.stop();
});
