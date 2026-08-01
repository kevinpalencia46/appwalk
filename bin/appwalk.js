#!/usr/bin/env node
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { runTree } from '../src/tui.js';
import { readFileSafe } from '../src/util.js';
import { TERMS, lookup, renderTerm } from '../src/glossary.js';
import { buildTour, printTour, detectStack } from '../src/walkthrough.js';
import { scanSecrets } from '../src/audit/secrets.js';
import { scanDuplicates } from '../src/audit/duplicates.js';
import { scanClutter } from '../src/audit/clutter.js';
import { scanDeps } from '../src/audit/deps.js';
import { scanGit } from '../src/audit/githygiene.js';
import { explain, providerAvailable } from '../src/ai/index.js';
import { educateText } from '../src/ai/educate.js';
import { monitor } from '../src/monitor.js';

const root = process.cwd();
const mode = process.argv[2] || 'walk';

const allFindings = async (m) => (await Promise.all([
  scanSecrets(m), scanDuplicates(m), scanClutter(m), scanDeps(m), scanGit(root, m),
])).flat();

if (mode === 'audit') {
  const map = await buildMap(root);
  const finds = await allFindings(map);
  if (!finds.length) console.log('audit: no findings 🎉');
  else {
    console.log(`audit: ${finds.length} finding(s)`);
    for (const f of finds) {
      if (f.kind === 'duplicate') { console.log(`≡ ${f.file}  ~duplicate of ${f.other} (sim ${f.sim}) — candidates to merge`); continue; }
      const glyph = /stripe_live|aws|github|google|slack|db_url|private_key|generic_key|env_in_git/.test(f.kind) ? '⚠'
        : /unused_dep|missing_lockfile|outdated_major/.test(f.kind) ? '⤫'
        : '·';
      console.log(`${glyph} ${f.file}${f.line ? ':' + f.line : ''} ${f.label || f.reason || f.kind}${f.snippet ? ` (${f.snippet})` : ''}`);
    }
  }
} else if (mode === 'tree') {
  const map = await buildMap(root);
  if (!map.flat.length) { console.log('appwalk: no files found (empty or fully ignored).'); process.exit(0); }
  await runTree(map);
} else if (mode === 'glossary') {
  const q = process.argv[3];
  if (!q) { console.log(TERMS.map((t) => t.term).join('\n')); process.exit(0); }
  const e = lookup(q);
  console.log(e ? renderTerm(e) : `no term "${q}". Try: appwalk glossary`);
} else if (mode === 'explain') {
  const file = process.argv[3];
  if (!file) { console.log('usage: appwalk explain <file>'); process.exit(0); }
  const text = await readFileSafe(join(root, file));
  const r = await explain(`Explain this file in plain language for a beginner:\n\n${(text || '').slice(0, 6000)}`, { lite: true });
  console.log(r.text); console.log(`\n[${r.model} · ~${r.tokens} tokens · ~$${r.costUsd.toFixed(4)}]`);
  if (!providerAvailable()) console.log('\n' + educateText());
} else if (mode === 'monitor') {
  const map = await buildMap(root);
  await monitor(root, detectStack(map), { explain: (msg) => explain(msg, { lite: true }) });
} else if (mode === 'walk') {
  const map = await buildMap(root);
  const tour = await buildTour(map, detectStack(map));
  console.log(printTour(tour));
} else {
  console.log(`appwalk: mode "${mode}" not built yet. Try: appwalk tree, appwalk glossary, appwalk walk`);
}
