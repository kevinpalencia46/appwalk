// Provider calls. Request/response shapes for anthropic, deepseek, ollama and the
// claude CLI were verified against live responses (appwalk captured fixtures 2026-08-01;
// claude CLI `--output-format json` fields `result`, `is_error`, `total_cost_usd`
// verified in this environment 2026-11-27). Kimi is NOT verified — see VERIFY below.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface CallInput {
  model: string; // provider-side id
  prompt: string;
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}
export interface CallOutput {
  text: string;
  inTokens: number;
  outTokens: number;
  /** Cost reported by the provider itself (claude CLI does this); otherwise computed from price table. */
  reportedUsd?: number;
}
export type ProviderStatus = 'ok' | 'needs_config' | 'needs_credentials' | 'unavailable';
export interface Provider {
  id: string;
  cloud: boolean;
  status(): Promise<{ status: ProviderStatus; detail?: string }>;
  call(i: CallInput): Promise<CallOutput>;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal, timeoutMs = 120_000) {
  const t = AbortSignal.timeout(timeoutMs);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, t]) : t,
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}: ${d?.error?.message || d?.error || 'error'}`);
  return d;
}

export function parseAnthropic(d: any): CallOutput {
  const text = (d.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return { text, inTokens: d.usage?.input_tokens || 0, outTokens: d.usage?.output_tokens || 0 };
}
export function parseOpenAiLike(d: any): CallOutput {
  return { text: d.choices?.[0]?.message?.content || '', inTokens: d.usage?.prompt_tokens || 0, outTokens: d.usage?.completion_tokens || 0 };
}
export function parseOllama(d: any): CallOutput {
  return { text: d.message?.content || '', inTokens: d.prompt_eval_count || 0, outTokens: d.eval_count || 0 };
}
export function parseClaudeCli(stdout: string): CallOutput {
  const j = JSON.parse(stdout);
  if (j.is_error) throw new Error(`claude cli: ${String(j.result || j.subtype || 'error').slice(0, 200)}`);
  return {
    text: String(j.result ?? ''),
    inTokens: (j.usage?.input_tokens || 0) + (j.usage?.cache_read_input_tokens || 0) + (j.usage?.cache_creation_input_tokens || 0),
    outTokens: j.usage?.output_tokens || 0,
    reportedUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined,
  };
}

const keyed = (env: string) => async () =>
  process.env[env] ? { status: 'ok' as const } : { status: 'needs_credentials' as const, detail: `set ${env} in .env` };

export function anthropic(): Provider {
  return {
    id: 'anthropic',
    cloud: true,
    status: keyed('ANTHROPIC_API_KEY'),
    async call({ model, prompt, system, maxTokens, signal }) {
      const d = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
        { model, max_tokens: maxTokens ?? 1500, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] },
        signal,
      );
      return parseAnthropic(d);
    },
  };
}

function openAiLike(id: string, url: string, envKey: string): Provider {
  return {
    id,
    cloud: true,
    status: keyed(envKey),
    async call({ model, prompt, system, maxTokens, signal }) {
      const d = await postJson(
        url,
        { authorization: `Bearer ${process.env[envKey] || ''}` },
        { model, max_tokens: maxTokens ?? 1500, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] },
        signal,
      );
      return parseOpenAiLike(d);
    },
  };
}
export const deepseek = () => openAiLike('deepseek', 'https://api.deepseek.com/v1/chat/completions', 'DEEPSEEK_API_KEY');
// VERIFY against live response: Kimi (Moonshot) endpoint + OpenAI-compatible shape are assumed, not captured.
export const kimi = () => openAiLike('kimi', process.env.KIMI_API_URL || 'https://api.moonshot.ai/v1/chat/completions', 'KIMI_API_KEY');

export function ollama(): Provider {
  const base = () => process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  let cache: { at: number; v: { status: ProviderStatus; detail?: string } } | null = null;
  return {
    id: 'ollama',
    cloud: false,
    async status() {
      if (cache && Date.now() - cache.at < 60_000) return cache.v;
      let v: { status: ProviderStatus; detail?: string };
      try {
        const r = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(1500) });
        v = r.ok ? { status: 'ok' } : { status: 'unavailable', detail: `ollama ${r.status}` };
      } catch {
        v = { status: 'unavailable', detail: `no Ollama at ${base()}` };
      }
      cache = { at: Date.now(), v };
      return v;
    },
    async call({ model, prompt, system, signal }) {
      const d = await postJson(
        `${base()}/api/chat`,
        {},
        { model, stream: false, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] },
        signal,
        300_000,
      );
      return parseOllama(d);
    },
  };
}

export function whichBin(bin: string): string | null {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Run `claude -p` headless. Used as a chat/plan model and by the claude_code tool. */
export function runClaudeCli(args: string[], opts: { cwd?: string; signal?: AbortSignal; timeoutMs?: number; input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    // Clear API-key vars so the CLI uses Kevin's own login rather than a stray key.
    const { ANTHROPIC_API_KEY: _a, DEEPSEEK_API_KEY: _d, KIMI_API_KEY: _k, TELEGRAM_BOT_TOKEN: _t, ...env } = process.env;
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], signal: opts.signal, timeout: opts.timeoutMs ?? 300_000 });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !out.trim()) reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
      else resolve(out);
    });
    child.stdin.end(opts.input ?? '');
  });
}

export function claudeCode(): Provider {
  return {
    id: 'claude_code',
    cloud: true,
    async status() {
      return whichBin(process.env.CLAUDE_BIN || 'claude') ? { status: 'ok' } : { status: 'unavailable', detail: 'claude CLI not on PATH' };
    },
    async call({ model, prompt, system, signal }) {
      const full = system ? `${system}\n\n${prompt}` : prompt;
      // Prompt goes over stdin so long contexts don't hit argv limits.
      const out = await runClaudeCli(['-p', '--output-format', 'json', '--model', model, '--max-turns', '1', '--tools', ''], { signal, input: full, timeoutMs: 240_000 });
      return parseClaudeCli(out);
    },
  };
}

export function defaultProviders(): Record<string, Provider> {
  return { anthropic: anthropic(), deepseek: deepseek(), kimi: kimi(), ollama: ollama(), claude_code: claudeCode() };
}
