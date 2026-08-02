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
test('educateText expands install instructions + security warnings per tier', () => {
  const s = educateText();
  assert.match(s, /ollama pull/, 'local tier shows the real install command');
  assert.match(s, /ollama\.com/, 'local tier links the download source');
  assert.match(s, /never commit/, 'keys are secrets — never commit them');
  assert.match(s, /gitignored/, 'says .env is gitignored for a reason');
  assert.match(s, /4GB\+ free/, 'warns about Ollama RAM needs');
  assert.match(s, /skip local models entirely/, 'tells when NOT to install');
  assert.match(s, /phone\/tablet or a low-spec laptop/, 'low-spec devices should use the cloud lite tier');
  assert.match(s, /AI_API_KEY/, 'lite tier shows the actual setup key name');
});

test('loadEnv reads appwalk\'s own .env and lets a project .env override', async () => {
  const { loadEnv } = await import('../src/ai/index.js');
  const env = loadEnv('/tmp');            // no project .env at /tmp
  assert.equal(env.AI_PROVIDER, 'anthropic');   // from ~/appwalk/.env
  assert.ok(env.AI_API_KEY && env.AI_API_KEY.length > 20);   // key present, not placeholder
});
