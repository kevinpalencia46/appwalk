// Parsers verified against REAL API responses captured 2026-08-01
// (test/fixtures/*.json) — the repo rule: never invent response shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAnthropic, parseDeepseek, parseOllama } from '../src/ai/providers.js';

const fix = (f) => readFile(join(import.meta.dirname, 'fixtures', f), 'utf8').then(JSON.parse);

test('parseAnthropic extracts text + token usage from a real response', async () => {
  const d = await fix('anthropic.json');
  const { text, tokens } = parseAnthropic(d);
  assert.ok(text.length > 0);
  assert.ok(tokens > 0);                    // input_tokens + output_tokens from the real payload
  assert.equal(typeof text, 'string');
});

test('parseDeepseek extracts message.content + total_tokens', async () => {
  const d = await fix('deepseek.json');
  const { text, tokens } = parseDeepseek(d);
  assert.ok(text.trim().length > 0);
  assert.equal(text, d.choices[0].message.content);   // exact field from the real payload
  assert.ok(tokens > 0);
  assert.equal(tokens, d.usage.total_tokens);         // real usage field, not an estimate
});

test('parseOllama extracts message.content + eval counts', async () => {
  const d = await fix('ollama.json');
  const { text, tokens } = parseOllama(d);
  assert.ok(text.length > 0);
  assert.ok(tokens >= 0);
  assert.equal(tokens, (d.prompt_eval_count || 0) + (d.eval_count || 0));
});

test('explain without a key still returns the deterministic hint (never crashes)', async () => {
  const { explain } = await import('../src/ai/index.js');
  const r = await explain('hello', { root: '/tmp' });   // no .env there
  assert.match(r.text, /AI explanation available/);
  assert.ok(r.tokens > 0);
  assert.ok(r.costUsd >= 0);
});
