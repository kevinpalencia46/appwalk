// Settings and paths. Everything comes from process.env (loaded from .env) so the same
// build runs in the cloud and on the Pi. Secrets are only ever read here, never logged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/src/env.js -> ren2/
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnvFile(file = path.join(ROOT, '.env')): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export interface Settings {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  workspace: string;
  knowledgeDir: string;
  agentsDir: string;
  configDir: string;
  ownerToken: string;
  telegramToken: string;
  telegramChatId: string;
  telegramApiBase: string;
  dashboardUrl: string;
  dailyBudgetUsd: number;
  adapterMode: 'mock' | 'live';
  oldRenKnowledgePath: string;
  providersOff: string[];
  tickMs: number;
  maxConcurrentTasks: number;
  digestCron: string;
  retroCron: string;
}

export function settings(): Settings {
  const e = process.env;
  const dataDir = path.resolve(ROOT, e.REN2_DATA_DIR || 'data');
  return {
    port: num(e.REN2_PORT, 8700),
    host: e.REN2_HOST || '127.0.0.1',
    dataDir,
    dbPath: e.REN2_DB_PATH ? path.resolve(ROOT, e.REN2_DB_PATH) : path.join(dataDir, 'ren2.db'),
    workspace: path.resolve(ROOT, e.REN2_WORKSPACE || 'workspace'),
    knowledgeDir: path.resolve(ROOT, e.REN2_KNOWLEDGE_DIR || 'knowledge'),
    agentsDir: path.resolve(ROOT, e.REN2_AGENTS_DIR || 'agents'),
    configDir: path.resolve(ROOT, e.REN2_CONFIG_DIR || 'config'),
    ownerToken: e.REN2_OWNER_TOKEN || '',
    telegramToken: e.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: e.TELEGRAM_CHAT_ID || '',
    telegramApiBase: e.TELEGRAM_API_BASE || 'https://api.telegram.org',
    dashboardUrl: e.REN2_DASHBOARD_URL || '',
    dailyBudgetUsd: num(e.REN2_DAILY_BUDGET_USD, 5),
    adapterMode: e.REN2_ADAPTER_MODE === 'live' ? 'live' : 'mock',
    oldRenKnowledgePath: e.OLD_REN_KNOWLEDGE_PATH || '',
    providersOff: (e.REN2_PROVIDERS_OFF || '').split(',').map((s) => s.trim()).filter(Boolean),
    tickMs: num(e.REN2_TICK_MS, 1000),
    maxConcurrentTasks: num(e.REN2_MAX_TASKS, 2),
    digestCron: e.REN2_DIGEST_CRON || '0 20 * * *',
    retroCron: e.REN2_RETRO_CRON || '0 7 * * 1',
  };
}

export function ensureDirs(s: Settings): void {
  for (const d of [s.dataDir, s.workspace, s.knowledgeDir]) fs.mkdirSync(d, { recursive: true });
}

/** Local calendar day, used for budget windows ("until midnight"). */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const nowIso = () => new Date().toISOString();
