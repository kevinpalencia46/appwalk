// Tools + adapters: path safety, destroy gate, shell limits, http guard, MCP parsing,
// adapter mock/live honesty, read-only adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCore, runToEnd, tmpdir } from './helpers.js';
import { runShell } from '../src/tools/shell.js';
import { privateHost, htmlToText } from '../src/tools/http.js';
import { parseRpcBody } from '../src/tools/mcp.js';
import { within } from '../src/tools/files.js';
import { allAdapters } from '../src/adapters/projects.js';
import { NotMapped } from '../src/adapters/base.js';
import { health } from '../src/health.js';

test('files: writes inside workspace ok; outside → destroy gate; .env never', async () => {
  const { core } = makeCore();
  const outside = path.join(tmpdir(), 'other.txt');
  fs.writeFileSync(outside, 'keep');
  const t = core.tasks.create({ objective: 'files', plan: [
    { tool: 'files', args: { action: 'write', path: 'notes/a.txt', content: 'hi' } },
    { tool: 'files', args: { action: 'read', path: 'notes/a.txt' } },
    { tool: 'files', args: { action: 'write', path: outside, content: 'overwrite' } },
  ] });
  const parked = await runToEnd(core, t.id);
  assert.equal(parked.state, 'needs_decision');
  assert.equal(core.gate.open()[0].gate, 'destroy');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep', 'not overwritten before approval');
  const t2 = core.tasks.create({ objective: 'env', plan: [{ tool: 'files', args: { action: 'write', path: '.env', content: 'X=1' } }] });
  assert.match((await runToEnd(core, t2.id)).error!, /never writes \.env/);
  assert.ok(within('/a/b/c', '/a/b') && !within('/a/bc', '/a/b'));
  await core.stop();
});

test('shell: timeout kills, output capped, secrets not passed to commands', async () => {
  const dir = tmpdir();
  const r = await runShell('sleep 5', { cwd: dir, timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  const big = await runShell('head -c 200000 /dev/zero | tr "\\0" a', { cwd: dir, timeoutMs: 5000 });
  assert.ok(big.out.length < 70_000 && big.out.includes('truncated'));
  process.env.TEST_SECRET_TOKEN = 'abcdefgh12345678';
  const env = await runShell('echo "[$TEST_SECRET_TOKEN]"', { cwd: dir, timeoutMs: 5000 });
  assert.equal(env.out.trim(), '[]');
  delete process.env.TEST_SECRET_TOKEN;
});

test('http: private hosts refused, html → text', () => {
  assert.ok(privateHost('127.0.0.1') && privateHost('192.168.1.4') && privateHost('localhost') && !privateHost('example.com'));
  assert.equal(htmlToText('<p>Hi&amp;<script>x</script><b>there</b></p>'), 'Hi& there');
});

test('mcp: JSON and SSE bodies parse', () => {
  assert.deepEqual(parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{"ok":1}}', 'application/json').result, { ok: 1 });
  assert.deepEqual(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n', 'text/event-stream').result, { tools: [] });
});

test('adapters: mock data is marked; live mode refuses to invent routes; read-only adapters have no actions', async () => {
  const ws = tmpdir();
  const mock = allAdapters('mock', ws);
  const sf = mock.find((a) => a.id === 'storefront')!;
  const r = await sf.call('summary', {}, { key: 'k', taskId: 1, agentId: null });
  assert.equal(r.mock, true);
  assert.match(r.text, /^\[MOCK\]/);
  assert.equal(r.data.mock, true);
  assert.equal((await sf.status()).state, 'mock');
  for (const id of ['meme', 'trading', 'oldren']) {
    const a = mock.find((x) => x.id === id)!;
    assert.ok(Object.values(a.methods).every((m) => m.kind === 'read'), `${id} is read only`);
  }
  const live = allAdapters('live', ws).find((a) => a.id === 'storefront')!;
  process.env.STOREFRONT_URL = 'http://127.0.0.1:9'; // nothing listens
  await assert.rejects(live.call('summary', {}, { key: 'k', taskId: 1, agentId: null }), NotMapped);
  assert.equal((await live.status()).state, 'unreachable');
  delete process.env.STOREFRONT_URL;
});

test('adapter actions are idempotent by step key (no double send after a restart)', async () => {
  const ws = tmpdir();
  const bge = allAdapters('mock', ws).find((a) => a.id === 'bge')!;
  const msgs = JSON.stringify([{ prospect_id: 'pr1', subject: 's', body: 'b' }]);
  const a = await bge.call('create_drafts', { messages: msgs }, { key: 't1s3', taskId: 1, agentId: 'outreach' });
  const b = await bge.call('create_drafts', { messages: msgs }, { key: 't1s3', taskId: 1, agentId: 'outreach' });
  assert.deepEqual(a.data.ids, b.data.ids);
  assert.match(b.text, /already saved/);
});

test('tool status reports are honest', async () => {
  const { core } = makeCore();
  const st = Object.fromEntries((await core.tools.statusAll(core)).map((t) => [t.name, t.status]));
  assert.equal(st.mcp_client, 'needs_config');
  assert.equal(st.notify, 'needs_credentials');
  assert.equal(st.memory, 'ok');
  const h = health();
  assert.ok(h.mem.total > 0 && typeof h.process_rss === 'number');
  await core.stop();
});
