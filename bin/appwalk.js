#!/usr/bin/env node
import { buildMap } from '../src/tree.js';
import { runTree } from '../src/tui.js';
import { TERMS, lookup, renderTerm } from '../src/glossary.js';
import { buildTour, printTour, detectStack } from '../src/walkthrough.js';
import { scanSecrets } from '../src/audit/secrets.js';
import { scanDuplicates } from '../src/audit/duplicates.js';
import { scanClutter } from '../src/audit/clutter.js';

const root = process.cwd();
const mode = process.argv[2] || 'walk';
if (mode === 'audit') {
  const map = await buildMap(root);
  const secrets = await scanSecrets(map);
  if (!secrets.length) console.log('audit: no secrets found 🎉');
  else for (const f of secrets) console.log(`⚠ ${f.file}:${f.line} ${f.label}${f.snippet ? ` (${f.snippet})` : ''}`);
  const dups = await scanDuplicates(map);
  for (const d of dups) console.log(`≡ ${d.file}  ~duplicate of ${d.other} (sim ${d.sim}) — candidates to merge`);
  const clut = await scanClutter(map);
  for (const c of clut) console.log(`· ${c.file}  ${c.reason}`);
} else if (mode === 'tree') {
  const map = await buildMap(root);
  if (!map.flat.length) { console.log('appwalk: no files found (empty or fully ignored).'); process.exit(0); }
  await runTree(map);
} else if (mode === 'glossary') {
  const q = process.argv[3];
  if (!q) { console.log(TERMS.map((t) => t.term).join('\n')); process.exit(0); }
  const e = lookup(q);
  console.log(e ? renderTerm(e) : `no term "${q}". Try: appwalk glossary`);
} else if (mode === 'walk') {
  const map = await buildMap(root);
  const tour = await buildTour(map, detectStack(map));
  console.log(printTour(tour));
} else {
  console.log(`appwalk: mode "${mode}" not built yet. Try: appwalk tree, appwalk glossary, appwalk walk`);
}
