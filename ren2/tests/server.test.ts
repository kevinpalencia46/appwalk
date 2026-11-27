// Every dashboard endpoint, plus owner-token auth and SSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { makeCore, runToEnd, waitFor } from './helpers.js';
import { createServer } from '../src/server.js';

async function boot(over: any = {}) {
  const { core, providers } = makeCore({ settings: over });
  const srv = createServer(core);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, body?: any, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: r.status, json, text, headers: r.headers };
  };
  return { core, providers, srv, base, call, close: async () => (srv.close(), await core.stop()) };
}

test('owner token: API 401 without it, login sets cookie, bearer works', async () => {
  const s = await boot({ ownerToken: 'owner-secret-123' });
  assert.equal((await s.call('GET', '/api/status')).status, 401);
  assert.equal((await s.call('GET', '/')).status, 302);
  assert.equal((await s.call('GET', '/healthz')).status, 200);
  const bad = await fetch(s.base + '/login', { method: 'POST', body: 'token=nope', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.equal(bad.status, 401);
  const ok = await fetch(s.base + '/login', { method: 'POST', body: 'token=owner-secret-123', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  assert.equal(ok.status, 302);
  const cookie = ok.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await s.call('GET', '/api/status', undefined, { cookie })).status, 200);
  assert.equal((await s.call('GET', '/api/status', undefined, { authorization: 'Bearer owner-secret-123' })).status, 200);
  await s.close();
});

test('every endpoint responds and does its job', async () => {
  const s = await boot();
  const { call, core } = s;
  const ok = async (m: string, p: string, body?: any) => {
    const r = await call(m, p, body);
    assert.equal(r.status, 200, `${m} ${p} → ${r.status} ${r.text.slice(0, 200)}`);
    return r.json;
  };
  core.memory.indexNotes();

  // Home
  assert.equal((await ok('GET', '/api/status')).halted, false);
  const chatTask = await ok('POST', '/api/chat', { text: 'summarize what is in memory about Storefront' });
  await runToEnd(core, chatTask.id);
  assert.ok((await ok('GET', '/api/chat')).length >= 2);
  assert.equal((await call('POST', '/api/chat', { text: '' })).status, 400);

  // Work
  const t = await ok('POST', '/api/tasks', { objective: 'echo', plan: [{ tool: 'shell', args: { cmd: 'exit 2' } }] });
  await runToEnd(core, t.id);
  assert.equal((await ok('GET', `/api/tasks/${t.id}`)).state, 'failed');
  assert.ok((await ok('GET', '/api/tasks?state=failed')).some((x: any) => x.id === t.id));
  core.tasks.updateStepArgs(t.id, 0, { cmd: 'echo ok' });
  await ok('POST', `/api/tasks/${t.id}/retry`);
  assert.equal((await runToEnd(core, t.id, ['done'])).state, 'done');
  await ok('POST', `/api/tasks/${t.id}/dismiss`);
  assert.ok(!(await ok('GET', '/api/tasks')).some((x: any) => x.id === t.id));
  assert.deepEqual(await ok('GET', '/api/failures'), []);
  assert.equal((await call('POST', '/api/tasks', { objective: 'x', plan: [{ tool: 'nope' }] })).status, 400);
  assert.equal((await call('GET', '/api/tasks/99999')).status, 404);

  // Decisions
  const g = await ok('POST', '/api/tasks', { objective: 'post', plan: [{ tool: 'publish', args: { action: 'draft', text: 'hello' } }, { tool: 'publish', args: { action: 'publish', text: 'hello' } }] });
  await runToEnd(core, g.id);
  const open = await ok('GET', '/api/decisions?status=open');
  assert.equal(open.length, 1);
  assert.equal((await call('POST', `/api/decisions/${open[0].id}`, { action: 'edit' })).status, 400, 'edit needs text');
  await ok('POST', `/api/decisions/${open[0].id}`, { action: 'approve' });
  assert.equal((await runToEnd(core, g.id, ['done'])).state, 'done');
  assert.ok((await ok('GET', '/api/decisions')).length >= 1);
  assert.equal((await call('POST', `/api/decisions/${open[0].id}`, { action: 'nope' })).status, 400);

  // Kill switch
  assert.equal((await ok('POST', '/api/kill')).halted, true);
  assert.equal((await ok('POST', '/api/resume')).halted, false);

  // Budget
  assert.equal((await ok('POST', '/api/budget', { cap: 9 })).cap, 9);
  assert.equal((await ok('GET', '/api/budget')).cap, 9);
  assert.equal((await call('POST', '/api/budget', { cap: -1 })).status, 400);

  // System
  const sys = await ok('GET', '/api/system');
  assert.ok(sys.health && sys.models.providers && sys.tools.length > 5);
  assert.equal(sys.telegram.status, 'needs_credentials');

  // Agents
  const agents = await ok('GET', '/api/agents');
  assert.equal(agents.length, 5);
  await ok('POST', '/api/agents/research/pause');
  assert.equal(core.agents.status('research'), 'paused');
  await ok('POST', '/api/agents/research/start');
  await ok('POST', '/api/agents/research/stop');
  assert.equal(core.agents.status('research'), 'stopped');
  await ok('POST', '/api/agents/research/start');
  const run = await ok('POST', '/api/agents/ops/run');
  assert.equal((await runToEnd(core, run.id)).state, 'done');
  const cfg = await ok('GET', '/api/agents/ops/config');
  assert.match(cfg.yaml, /id: ops/);
  await ok('PUT', '/api/agents/ops/config', { yaml: cfg.yaml.replace('daily_budget_usd: 0.10', 'daily_budget_usd: 0.20') });
  assert.equal(core.agents.get('ops')!.daily_budget_usd, 0.2);
  assert.equal((await call('PUT', '/api/agents/ops/config', { yaml: 'id: ops\n' })).status, 400);
  const created = await ok('POST', '/api/agents', { id: 'scout', name: 'Scout', mission: 'Look around', projects: ['storefront'], schedule: '0 9 * * *' });
  assert.equal(created.id, 'scout');
  core.agents.applyPlaybook('scout', '- v2', 'test');
  assert.equal((await ok('GET', '/api/agents/scout/playbook')).length, 2);
  await ok('POST', '/api/agents/scout/playbook/revert', { version: 1 });
  assert.notEqual(core.agents.playbook('scout'), '- v2');
  core.agents.addAuto('scout', 'post:x');
  assert.deepEqual(await ok('DELETE', '/api/auto/scout/post%3Ax'), []);
  assert.equal((await call('POST', '/api/agents/nobody/start')).status, 404);

  // Projects
  const projects = await ok('GET', '/api/projects');
  assert.equal(projects.length, 7);
  const sf = projects.find((p: any) => p.id === 'storefront');
  assert.equal(sf.state, 'mock');
  assert.ok(sf.numbers.every((n: any) => /MOCK|mock/.test(n.label)), 'mock numbers are labelled');

  // Memory
  const mem = await ok('GET', '/api/memory?q=storefront');
  assert.ok(mem.items.length >= 1);
  const note = await ok('POST', '/api/memory', { project: 'builder', kind: 'fact', title: 'Builder note', body: 'Runs on 8400' });
  assert.equal((await ok('GET', `/api/memory/${note.id}`)).title, 'Builder note');
  assert.match((await ok('PUT', `/api/memory/${note.id}`, { body: 'Runs on 8400 (Pi)' })).body, /\(Pi\)/);
  await ok('POST', '/api/memory/reindex');
  assert.ok(Array.isArray(await ok('GET', '/api/drafts')));
  assert.ok((await ok('GET', '/api/meta')).gates.includes('destroy'));

  // Alerts
  core.alert('warn', 'test alert', 'k1');
  const alerts = await ok('GET', '/api/alerts');
  await ok('POST', `/api/alerts/${alerts[0].id}/dismiss`);
  assert.equal((await ok('GET', '/api/alerts')).length, 0);

  // Static + SPA fallback + unknown API
  assert.match((await call('GET', '/')).text, /<title>Ren 2<\/title>/);
  assert.match((await call('GET', '/app.js')).text, /EventSource/);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  await s.close();
});

test('SSE stream delivers live events', async () => {
  const s = await boot();
  const ac = new AbortController();
  const r = await fetch(s.base + '/api/events', { signal: ac.signal });
  const reader = r.body!.getReader();
  let buf = '';
  const reading = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
  })().catch(() => {});
  s.core.chat('dashboard', 'hello');
  await waitFor(() => buf.includes('event: task'), 3000, 'task event');
  ac.abort();
  await reading;
  await s.close();
});
