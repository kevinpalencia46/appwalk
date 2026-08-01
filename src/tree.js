// src/tree.js
import { readFile, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { walk, langOf, rel, readFileSafe } from './util.js';

const ENTRY_NAMES = new Set(['package.json', 'index.html', 'main.py', 'app.py', 'manage.py', 'Dockerfile', 'README.md', 'server.js', 'server.py', 'index.js', 'index.ts', 'app.js', 'app.ts', 'main.js', 'main.ts', 'vite.config.js', 'vite.config.ts']);

export async function isEntry(name, text) {
  if (ENTRY_NAMES.has(name)) return true;
  if (!/\.(js|ts|py|jsx|tsx)$/.test(name) || text.length < 200) return false;
  return /express|flask|fastapi|createServer|app\.listen|if __name__/.test(text.slice(0, 600));
}

export async function buildMap(root) {
  const files = await walk(root);
  const flat = [];
  for (const abs of files) {
    let s; try { s = await stat(abs); } catch { continue; }
    const text = await readFileSafe(abs);
    const name = basename(abs);
    flat.push({
      path: abs,
      name,
      dir: rel(root, dirname(abs)),
      lang: langOf(abs),
      size: s.size,
      mtime: s.mtimeMs,
      entry: await isEntry(name, text || ''),
    });
  }
  return { root, flat, entryPoints: flat.filter((n) => n.entry) };
}
