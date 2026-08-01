// Live AI provider calls. Response shapes verified against real API responses
// captured 2026-08-01 in test/fixtures/ (anthropic.json, deepseek.json, ollama.json).
// Each call* returns { text, tokens } or throws; the parse* functions are pure so the
// parsers are unit-tested against the captured shapes without network.

import { spawn } from 'node:child_process';

export function parseAnthropic(d) {
  const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const tokens = (d.usage?.input_tokens || 0) + (d.usage?.output_tokens || 0);
  return { text, tokens };
}

export async function callAnthropic({ model, prompt, system, key }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1024, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${d.error?.message || 'error'}`);
  return parseAnthropic(d);
}

export function parseDeepseek(d) {
  return { text: d.choices?.[0]?.message?.content || '', tokens: d.usage?.total_tokens || 0 };
}

export async function callDeepseek({ model, prompt, system, key }) {
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`deepseek ${r.status}: ${d.error?.message || 'error'}`);
  return parseDeepseek(d);
}

export function parseOllama(d) {
  return { text: d.message?.content || '', tokens: (d.prompt_eval_count || 0) + (d.eval_count || 0) };
}

export async function callOllama({ model, prompt, system }) {
  const r = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false, messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ollama ${r.status}: ${d.error || 'error'}`);
  return parseOllama(d);
}

export function callClaudeCode({ prompt, system }) {
  // Clear API-key env vars so claude -p uses the user's own login, not a leaked key
  // (verified 2026-08-01: claude warns ANTHROPIC_API_KEY takes precedence).
  return new Promise((resolve, reject) => {
    const { ANTHROPIC_API_KEY: _a, DEEPSEEK_API_KEY: _d, KIMI_API_KEY: _k, ...env } = process.env;
    const text = system ? `${system}\n\n${prompt}` : prompt;
    const child = spawn('claude', ['-p', text], { stdio: ['ignore', 'pipe', 'pipe'], env, timeout: 120000 });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => reject(e));
    child.on('exit', (code) => {
      if (code !== 0 && !out.trim()) return reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      resolve({ text: out.trim(), tokens: Math.ceil(out.length / 4) });
    });
  });
}
