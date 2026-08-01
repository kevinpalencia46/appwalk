// src/ai/models.js
export const TIERS = {
  anthropic: { lite: { id: 'claude-sonnet-5', cost: 0.0000003 }, pro: { id: 'claude-opus-5', cost: 0.000005 } },
  deepseek:  { lite: { id: 'deepseek-chat', cost: 0.00000027 }, pro: { id: 'deepseek-chat', cost: 0.00000027 } },
  ollama:    { lite: { id: 'llama3.2:3b', cost: 0 }, pro: { id: 'qwen2.5-coder:7b', cost: 0 } },
  'claude-code': { lite: { id: 'Claude Code', cost: 0 }, pro: { id: 'Claude Code', cost: 0 } },
};
export const costFor = (provider, tier, tokens) => Math.round((TIERS[provider]?.[tier]?.cost || 0) * tokens * 100) / 100;
