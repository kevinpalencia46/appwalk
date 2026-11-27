// Logging + secret redaction. Any value of an env var that looks like a secret is
// replaced with *** before it reaches a log line, Telegram, the UI or a stored output.
import { EventEmitter } from 'node:events';

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASS)$/i;

export function secretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([k, v]) => SECRET_NAME.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v as string)
    .sort((a, b) => b.length - a.length);
}

export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = String(text ?? '');
  for (const v of secretValues(env)) out = out.split(v).join('***');
  // Common token shapes even when not in env (e.g. pasted into an output).
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-***').replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '***');
  return out;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const quiet = () => process.env.REN2_LOG === 'quiet';

export function log(level: Level, msg: string, extra?: unknown): void {
  if (quiet() && level !== 'error') return;
  if (level === 'debug' && !process.env.REN2_DEBUG) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${extra === undefined ? '' : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))}`;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(redact(line) + '\n');
}

/** In-process event bus. The SSE stream and Telegram notifier listen here. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);
export function emit(type: string, data: unknown = {}): void {
  bus.emit('event', { type, data, ts: new Date().toISOString() });
}
