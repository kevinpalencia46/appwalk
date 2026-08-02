// src/ai/index.js — BYO-key AI layer. Deterministic hint when unconfigured;
// live provider calls (verified response shapes) when a key is set.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIERS, costFor } from './models.js';
import { callAnthropic, callDeepseek, callOllama, callClaudeCode } from './providers.js';
export { TIERS, costFor } from './models.js';

export function loadEnv(root = process.cwd()) {
  // The user's key lives in appwalk's OWN .env (~/appwalk/.env); a project-local
  // .env may override it. Otherwise `appwalk explain` run inside any project would
  // never find the key (it reads cwd/.env today, which the project doesn't own).
  const out = {};
  const candidates = [new URL('../../.env', import.meta.url).pathname, join(root, '.env')];
  for (const path of candidates) {
    try {
      const txt = readFileSync(path, 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {}
  }
  return out;
}

export const pickLite = (env = loadEnv()) =>
  env.AI_PROVIDER === 'ollama' ? 'ollama' : env.AI_PROVIDER === 'claude-code' ? 'claude-code' : 'anthropic';

export function providerAvailable(env = loadEnv()) {
  const p = env.AI_PROVIDER || 'anthropic';
  if (p === 'ollama' || p === 'claude-code') return true;
  return !!env.AI_API_KEY;
}

const SYSTEM = 'You are appwalk, a patient teacher explaining code to a beginner. Be plain, concrete, and encouraging: say what something is, why it matters, and how it fits.';

export async function explain(prompt, { lite = true, root = process.cwd(), env } = {}) {
  const env_ = env ?? loadEnv(root);
  const provider = env_.AI_PROVIDER || 'anthropic';
  // Unrecognized/placeholder AI_PROVIDER must fall back to anthropic lite, and cost
  // must come from the RESOLVED provider's tier (unknown providers costed $0 before).
  const tier = TIERS[provider]?.[lite ? 'lite' : 'pro'] ?? TIERS.anthropic.lite;
  const costProvider = TIERS[provider] ? provider : 'anthropic';
  const estimated = Math.ceil(prompt.length / 4);

  if (!providerAvailable(env_)) {
    return {
      text: `[AI explanation available — set AI_API_KEY (and optionally AI_PROVIDER) in .env to enable. Recommended: a lite model like ${tier.id} for cheap explanations.]`,
      model: tier.id, tokens: estimated, costUsd: costFor(costProvider, lite ? 'lite' : 'pro', estimated),
    };
  }

  try {
    const key = env_.AI_API_KEY;
    let res;
    if (provider === 'ollama') res = await callOllama({ model: tier.id, prompt, system: SYSTEM });
    else if (provider === 'claude-code') res = await callClaudeCode({ prompt, system: SYSTEM });
    else if (provider === 'deepseek') res = await callDeepseek({ model: tier.id, prompt, system: SYSTEM, key });
    else res = await callAnthropic({ model: tier.id, prompt, system: SYSTEM, key });
    const tokens = res.tokens || estimated;
    return { text: res.text, model: tier.id, tokens, costUsd: costFor(costProvider, lite ? 'lite' : 'pro', tokens) };
  } catch (e) {
    return {
      text: `[AI call failed: ${e.message} — check AI_PROVIDER/AI_API_KEY in .env. The core appwalk modes work without AI. (FAQ: ai-failed)]`,
      model: tier.id, tokens: estimated, costUsd: 0,
    };
  }
}
