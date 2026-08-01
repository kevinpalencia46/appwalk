// src/audit/duplicates.js
import { readFileSafe } from '../util.js';
function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
export async function scanDuplicates(map, { minSim = 0.8 } = {}) {
  const texts = [];
  for (const node of map.flat) {
    // Docs (.md/.txt) embed code and aren't merge candidates — skip them.
    if (/\.(md|txt)$/.test(node.name)) continue;
    if (!/\.(js|ts|jsx|tsx|py|html|css|json)$/.test(node.name)) continue;
    if (node.size < 30) continue; // skip trivial one-liners, keep small-but-real files
    const t = await readFileSafe(node.path);
    if (t) texts.push({ node, t: norm(t) });
  }
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].t, b = texts[j].t;
      if (!a || !b) continue;
      if (a === b) { out.push({ file: texts[i].node.path, kind: 'duplicate', other: texts[j].node.path, sim: 1 }); continue; }
      // containment sim (short vs long) + token overlap
      const shorter = a.length < b.length ? a : b, longer = a.length < b.length ? b : a;
      if (shorter.length > 50 && longer.includes(shorter)) out.push({ file: texts[i].node.path, kind: 'duplicate', other: texts[j].node.path, sim: 0.95 });
    }
  }
  return out;
}
