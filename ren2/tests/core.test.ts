// db, budget, router, memory, cron, providers parsing, redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, migrate, kvSet, kvGet } from '../src/db.js';
import { Budget } from '../src/budget.js';
import { Router, NoModelError } from '../src/router/router.js';
import { Memory, ftsQuery, parseNote } from '../src/memory/memory.js';
import { cronMatches, validCron } from '../src/agents/cron.js';
import { parseAnthropic, parseOpenAiLike, parseOllama, parseClaudeCli } from '../src/router/providers.js';
import { redact, bus } from '../src/log.js';
import { ROOT } from '../src/env.js';
import { fake, off, tmpdir } from './helpers.js';

test('migrations are idempotent and kv works', () => {
  const dir = tmpdir();
  const db = openDb(path.join(dir, 'a.db'));
  assert.equal(migrate(db), 2);
  assert.equal(migrate(db), 2);
  kvSet(db, 'x', '1');
  kvSet(db, 'x', '2');
  assert.equal(kvGet(db, 'x'), '2');
});

test('budget: 80% warns once, 100% pauses cloud, per-agent cap, today-only raise', () => {
  const db = openDb(':memory:');
  const b = new Budget(db, 1);
  const events: string[] = [];
  const on = (e: any) => events.push(e.type);
  bus.on('event', on);
  b.record({ provider: 'p', model: 'm', usd: 0.5, cloud: true });
  assert.ok(b.allowCloud().ok);
  b.record({ provider: 'p', model: 'm', usd: 0.35, cloud: true }); // 85%
  b.record({ provider: 'p', model: 'm', usd: 0.01, cloud: true });
  assert.equal(events.filter((e) => e === 'budget.warn').length, 1);
  b.record({ provider: 'p', model: 'm', usd: 0.2, cloud: true, agentId: 'research' }); // 106%
  assert.equal(events.filter((e) => e === 'budget.paused').length, 1);
  assert.equal(b.allowCloud().ok, false);
  b.setCap(10, true);
  assert.equal(b.cap(), 10);
  assert.ok(b.allowCloud().ok);
  assert.equal(b.allowCloud('research', 0.1).ok, false, 'per-agent cap');
  assert.ok(b.allowCloud('content', 0.1).ok);
  bus.off('event', on);
});

test('router: falls back through the route, logs cost, skips unconfigured', async () => {
  const db = openDb(':memory:');
  const b = new Budget(db, 5);
  const a = fake('anthropic', true);
  a.fail = true;
  const cc = fake('claude_code', true);
  const r = new Router(b, path.join(ROOT, 'config'), { anthropic: a, claude_code: cc, deepseek: off('deepseek'), kimi: off('kimi'), ollama: fake('ollama', false) });
  const out = await r.complete({ kind: 'chat', prompt: 'hi', taskId: 1 });
  assert.equal(out.provider, 'claude_code');
  assert.equal(a.calls.length, 1, 'tried anthropic first');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM costs WHERE provider = ?').get('claude_code') as any).n, 1, 'call logged');
  const st = await r.status();
  assert.equal(st.providers.deepseek.status, 'needs_credentials');
});

test('router: budget exhausted blocks cloud but local still runs; nothing → NoModelError', async () => {
  const db = openDb(':memory:');
  const b = new Budget(db, 0.0001);
  b.record({ provider: 'x', model: 'x', usd: 1, cloud: true });
  const loc = fake('ollama', false);
  const r = new Router(b, path.join(ROOT, 'config'), { anthropic: fake('anthropic', true), claude_code: fake('claude_code', true), deepseek: off('deepseek'), kimi: off('kimi'), ollama: loc });
  const out = await r.complete({ kind: 'chat', prompt: 'hi' });
  assert.equal(out.provider, 'ollama');
  loc.state = 'unavailable';
  await assert.rejects(r.complete({ kind: 'chat', prompt: 'hi' }), NoModelError);
});

test('router: REN2_PROVIDERS_OFF disables a provider', async () => {
  const db = openDb(':memory:');
  const r = new Router(new Budget(db, 5), path.join(ROOT, 'config'), { anthropic: fake('anthropic', true), claude_code: fake('claude_code', true), deepseek: off('deepseek'), kimi: off('kimi'), ollama: fake('ollama', false) }, ['anthropic']);
  assert.equal((await r.complete({ kind: 'chat', prompt: 'x' })).provider, 'claude_code');
});

test('memory: FTS search, sanitized queries, notes indexed and editable', () => {
  const dir = tmpdir();
  const kdir = path.join(dir, 'k');
  fs.mkdirSync(path.join(kdir, 'storefront'), { recursive: true });
  fs.writeFileSync(path.join(kdir, 'storefront', 'a.md'), '---\nkind: decision\n---\n# Pricing\n\nWe show shipping upfront.\n');
  const m = new Memory(openDb(':memory:'), kdir);
  assert.deepEqual(m.indexNotes(), { added: 1, updated: 0, removed: 0 });
  assert.deepEqual(m.indexNotes(), { added: 0, updated: 0, removed: 0 });
  m.add({ project: 'builder', kind: 'fact', title: 'Builder port', body: 'Builder runs on 8400' });
  assert.equal(m.search('shipping', {})[0].title, 'Pricing');
  assert.equal(m.search('shipping', {})[0].kind, 'decision');
  assert.equal(m.search('what about "builder" OR ) port?')[0].title, 'Builder port');
  assert.equal(ftsQuery('the a of'), '');
  const it = m.search('pricing')[0];
  m.update(it.id, { body: 'Shipping is free over $50.' });
  assert.match(fs.readFileSync(path.join(kdir, 'storefront', 'a.md'), 'utf8'), /free over \$50/);
  const n = m.createNote({ project: 'storefront', kind: 'lesson', title: 'Checkout friction', body: 'Account required at checkout.' });
  assert.ok(fs.existsSync(path.join(kdir, n.path!)));
  assert.match(m.contextFor('checkout account', 'storefront').text, /Checkout friction/);
  fs.rmSync(path.join(kdir, n.path!));
  assert.equal(m.indexNotes().removed, 1);
});

test('parseNote reads front matter and falls back to folder/heading', () => {
  const n = parseNote('# Hello\nbody', 'builder/x.md');
  assert.deepEqual([n.project, n.kind, n.title], ['builder', 'fact', 'Hello']);
});

test('cron matcher', () => {
  const d = new Date(2026, 10, 27, 6, 0); // Fri 27 Nov 2026 06:00
  assert.ok(cronMatches('0 6 * * *', d));
  assert.ok(!cronMatches('0 7 * * *', d));
  assert.ok(cronMatches('*/30 * * * *', d));
  assert.ok(cronMatches('0 6 * * 5', d));
  assert.ok(cronMatches('0 6 * * 1-5', d));
  assert.ok(!cronMatches('0 6 * * 2,4', d));
  assert.ok(validCron('0 10 * * 2,4'));
  assert.ok(!validCron('nope'));
});

test('provider parsers match verified shapes', () => {
  assert.equal(parseAnthropic({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 3, output_tokens: 2 } }).text, 'hi');
  assert.equal(parseOpenAiLike({ choices: [{ message: { content: 'yo' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }).text, 'yo');
  assert.equal(parseOllama({ message: { content: 'local' }, eval_count: 3 }).outTokens, 3);
  const c = parseClaudeCli(JSON.stringify({ result: 'ok', is_error: false, total_cost_usd: 0.0117, usage: { input_tokens: 2, output_tokens: 4 } }));
  assert.equal(c.text, 'ok');
  assert.equal(c.reportedUsd, 0.0117);
  assert.throws(() => parseClaudeCli(JSON.stringify({ result: 'bad', is_error: true })));
});

test('redact hides secret env values and token shapes', () => {
  const out = redact('key=supersecretvalue123 and sk-abcdefghijklmnopqrstu', { MY_API_KEY: 'supersecretvalue123' } as any);
  assert.ok(!out.includes('supersecretvalue123'));
  assert.ok(!out.includes('sk-abcdefghijklmnopqrstu'));
});
