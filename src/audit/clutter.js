// src/audit/clutter.js
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSafe } from '../util.js';

// match the dirs walk() in util.js skips, so we never flag standard/ignored dirs
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.venv', 'venv', '__pycache__', '.superpowers']);

export async function scanClutter(map) {
  const out = [];
  for (const node of map.flat) {
    if (/\.(bak|tmp|orig|swp)$/i.test(node.name)) out.push({ file: node.path, kind: 'bak', reason: `${node.name} looks like a leftover backup file` });
    else if (node.name.toLowerCase() === 'todo') out.push({ file: node.path, kind: 'todo_only', reason: 'a file literally named TODO' });
    else if (/(\.js|\.py)$/.test(node.name)) {
      const t = await readFileSafe(node.path);
      if (t && /^\s*(\/\/|#|<!--|~).*$/m.test(t) && !t.trim().replace(/^\s*(#|\/\/|<!--|~).*$/gm, '').trim())
        out.push({ file: node.path, kind: 'todo_only', reason: 'contains only comments/TODO lines — likely never finished' });
    }
  }
  // empty directories: map.flat only contains files, so a truly-empty dir never appears
  // in it — scan the tree to enumerate every non-hidden dir, then flag the empty ones.
  const dirs = new Set();
  async function findDirs(dir, relDir) {
    let ents;
    try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const r = relDir ? relDir + '/' + e.name : e.name;
      dirs.add(r);
      await findDirs(join(dir, e.name), r);
    }
  }
  await findDirs(map.root, '');
  for (const d of dirs) {
    let ents; try { ents = await readdir(join(map.root, d)); } catch { continue; }
    if (!ents.length) out.push({ file: d, kind: 'empty_dir', reason: 'empty directory — can be removed' });
  }
  return out;
}
