// test/ai.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, pickLite, costFor, providerAvailable } from '../src/ai/index.js';
import { educateText } from '../src/ai/educate.js';

test('TIERS map lite+pro for each provider', () => {
  for (const p of ['anthropic', 'deepseek', 'ollama', 'claude-code']) assert.ok(TIERS[p].lite, `no lite for ${p}`);
  assert.ok(TIERS.anthropic.pro.cost > 0);
});
test('pickLite returns a provider-agnostic default', () => {
  assert.ok(pickLite({}));
});
test('costFor computes from tokens', () => {
  assert.ok(costFor('anthropic', 'pro', 1000) > 0);
  assert.equal(costFor('ollama', 'pro', 1000), 0);   // local is free
});
test('providerAvailable is hermetic to env keys', () => {
  assert.equal(providerAvailable({}), false);                 // no keys → false
  assert.equal(providerAvailable({ AI_API_KEY: 'x' }), true); // a key → true
  assert.equal(providerAvailable({ AI_PROVIDER: 'ollama' }), true); // local provider needs no key → true
});
test('educateText teaches lite vs pro vs local', () => {
  const s = educateText();
  assert.match(s, /lite/i);
  assert.match(s, /pro/i);
  assert.match(s, /local/i);
});
