// src/ai/models.js
// Model IDs VERIFIED against the live APIs 2026-08-01 (claude-sonnet-5, claude-opus-5 and
// deepseek-v4-flash all returned real responses; llama3.2:3b is the local Ollama model).
// `cost` is ~$ per 1,000 tokens (input+output blended), for honest cost transparency.
export const TIERS = {
  anthropic: { lite: { id: 'claude-sonnet-5', cost: 0.003 }, pro: { id: 'claude-opus-5', cost: 0.015 } },
  deepseek:  { lite: { id: 'deepseek-v4-flash', cost: 0.00027 }, pro: { id: 'deepseek-v4-flash', cost: 0.00027 } },
  ollama:    { lite: { id: 'llama3.2:3b', cost: 0 }, pro: { id: 'llama3.2:3b', cost: 0 } },
  'claude-code': { lite: { id: 'Claude Code', cost: 0 }, pro: { id: 'Claude Code', cost: 0 } },
};
export const costFor = (provider, tier, tokens) =>
  Math.round(((TIERS[provider]?.[tier]?.cost || 0) * tokens / 1000) * 1e6) / 1e6;
