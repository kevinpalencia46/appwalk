// src/ai/index.js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIERS } from './models.js';
export { TIERS } from './models.js';
export const costFor = (provider, tier, tokens) => Math.round((TIERS[provider]?.[tier]?.cost || 0) * tokens * 100) / 100;

export function loadEnv(root = process.cwd()) {
  const out = {};
  try {
    const txt = readFileSync(join(root, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

export const pickLite = (env = loadEnv()) =>
  env.AI_PROVIDER === 'ollama' ? 'ollama' : env.AI_PROVIDER === 'claude-code' ? 'claude-code' : 'anthropic';

export function providerAvailable(env = loadEnv()) {
  if (env.AI_PROVIDER === 'ollama' || env.AI_PROVIDER === 'claude-code') return true;
  return !!env.AI_API_KEY;
}

export function explain(prompt, { lite = true, root = process.cwd() } = {}) {
  const env = loadEnv(root);
  const provider = env.AI_PROVIDER || 'anthropic';
  const tier = TIERS[provider]?.[lite ? 'lite' : 'pro'];
  const tokens = Math.ceil(prompt.length / 4);
  // # VERIFY against live response for each provider's real request/response shape.
  // v1: return the deterministic cost estimate + a clear hint; wire live calls in a
  // follow-up once provider response shapes are captured (per repo rule: never invent).
  return Promise.resolve({
    text: `[AI explanation available — set AI_API_KEY (and optionally AI_PROVIDER/AI_MODEL) in .env to enable. Recommended: a lite model like ${tier?.id} for cheap explanations.]`,
    model: tier?.id || 'none', tokens, costUsd: costFor(provider, lite ? 'lite' : 'pro', tokens),
  });
}
