// One-time import of the old Ren knowledge folder + project docs into knowledge/imported/.
// Reads sources read-only (never writes to them). Runs once; pass --force to re-import.
// Sources: OLD_REN_KNOWLEDGE_PATH and PROJECT_DOCS_PATHS (comma separated) from .env, or argv.
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile, settings, ensureDirs } from '../src/env.js';
import { openDb, kvGet, kvSet } from '../src/db.js';
import { Memory } from '../src/memory/memory.js';

loadEnvFile();
const s = settings();
ensureDirs(s);
const force = process.argv.includes('--force');
const argPaths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sources = (argPaths.length ? argPaths : [s.oldRenKnowledgePath, ...(process.env.PROJECT_DOCS_PATHS || '').split(',')])
  .map((p) => p.trim().replace(/^~(?=\/)/, process.env.HOME || '~'))
  .filter(Boolean);

const db = openDb(s.dbPath);
if (kvGet(db, 'import.done') && !force) {
  console.log(`Already imported on ${kvGet(db, 'import.done')}. Use --force to import again.`);
  process.exit(0);
}
if (!sources.length) {
  console.log('Nothing to import: set OLD_REN_KNOWLEDGE_PATH (and optionally PROJECT_DOCS_PATHS) in .env, or pass paths.');
  process.exit(0);
}

const TEXT = /\.(md|markdown|txt)$/i;
const MAX = 512 * 1024;
let copied = 0;
let skipped = 0;
for (const src of sources) {
  if (!fs.existsSync(src)) {
    console.log(`skip (missing): ${src}`);
    continue;
  }
  const label = path.basename(path.resolve(src)).replace(/[^a-zA-Z0-9_-]/g, '_') || 'source';
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && TEXT.test(e.name)) {
        if (fs.statSync(p).size > MAX) {
          skipped++;
          continue;
        }
        const text = fs.readFileSync(p, 'utf8');
        if (/^(\s*[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S{8,})/m.test(text)) {
          console.log(`skip (looks like it contains a secret): ${p}`);
          skipped++;
          continue;
        }
        const rel = path.relative(src, p);
        const dest = path.join(s.knowledgeDir, 'imported', label, rel.replace(/\.txt$/i, '.md'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const project = rel.split(path.sep).length > 1 ? rel.split(path.sep)[0].toLowerCase() : 'general';
        const fm = text.startsWith('---\n') ? '' : `---\nproject: ${project}\nkind: fact\n---\n`;
        fs.writeFileSync(dest, fm + text);
        copied++;
      }
    }
  };
  walk(src);
}
const res = new Memory(db, s.knowledgeDir).indexNotes();
kvSet(db, 'import.done', new Date().toISOString());
console.log(`Imported ${copied} file(s) (${skipped} skipped) into knowledge/imported/. Index: +${res.added} ~${res.updated}.`);
db.close();
