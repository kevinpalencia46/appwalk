// Backup: consistent DB snapshot (VACUUM INTO) + knowledge/ → backups/ren2-YYYYmmdd-HHMMSS.tar.gz.
// Keeps the newest 14. Run from cron/systemd timer: `node dist/scripts/backup.js`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnvFile, settings, ROOT } from '../src/env.js';
import { DatabaseSync } from 'node:sqlite';

loadEnvFile();
const s = settings();
const keep = Number(process.env.REN2_BACKUP_KEEP || 14);
const dir = path.resolve(ROOT, process.env.REN2_BACKUP_DIR || 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const stage = fs.mkdtempSync(path.join(dir, '.stage-'));
try {
  const snap = path.join(stage, 'ren2.db');
  const db = new DatabaseSync(s.dbPath);
  db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
  db.close();
  if (fs.existsSync(s.knowledgeDir)) fs.cpSync(s.knowledgeDir, path.join(stage, 'knowledge'), { recursive: true });
  const out = path.join(dir, `ren2-${stamp}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', stage, '.']);
  console.log(`backup: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

const all = fs.readdirSync(dir).filter((f) => /^ren2-\d{8}-\d{6}\.tar\.gz$/.test(f)).sort();
for (const f of all.slice(0, Math.max(0, all.length - keep))) {
  fs.rmSync(path.join(dir, f));
  console.log(`pruned ${f}`);
}
