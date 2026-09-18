import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// A seeded shuffle, so anyone holding the seed can reproduce the exact sample.
// Math.random would make the study unrepeatable, which defeats the point of
// publishing the method alongside the findings.
function seededOrder(rows, seed) {
  return rows
    .map((row) => ({
      row,
      key: createHash('sha256').update(`${seed}:${row.full_name}`).digest('hex'),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((x) => x.row);
}

export function drawSample(candidates, size, seed) {
  return seededOrder(candidates, seed).slice(0, size);
}

export async function writeCorpus(rows, path) {
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}
