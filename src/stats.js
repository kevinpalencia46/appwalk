// Local, opt-in-visible usage counters (per the product brief §0). No telemetry home —
// a user can open, inspect, and delete ~/.appwalk/stats.json anytime. The counters let us
// MEASURE which feature is the paid hook instead of guessing: if <20% of users configure
// an AI key, `explain` is not it — the audit + HTML report is.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE = join(homedir(), '.appwalk', 'stats.json');
const ZERO = { reached_model_step: 0, configured_key: 0, skipped_key: 0, ran_explain: 0, ran_audit_report: 0 };

function read() {
  try { return { ...ZERO, ...JSON.parse(readFileSync(FILE, 'utf8')) }; }
  catch { return { ...ZERO }; }
}

function write(s) {
  try {
    mkdirSync(join(homedir(), '.appwalk'), { recursive: true });
    writeFileSync(FILE, JSON.stringify(s, null, 2));
  } catch {}
}

export function inc(key) {
  const s = read();
  s[key] = (s[key] || 0) + 1;
  write(s);
}

export function statsPath() { return FILE; }
