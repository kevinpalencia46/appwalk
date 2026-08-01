#!/usr/bin/env node
import { join } from 'node:path';
import { readFileSafe } from '../src/util.js';
import { buildMap } from '../src/tree.js';
import { shell } from '../src/tui/app.js';
import { TERMS, lookup, renderTerm } from '../src/glossary.js';
import { detectStack } from '../src/walkthrough.js';
import { allFindings } from '../src/audit/index.js';
import { explain, providerAvailable, pickLite } from '../src/ai/index.js';
import { educateText } from '../src/ai/educate.js';
import { monitor } from '../src/monitor.js';
import { renderReport } from '../src/report.js';
import { writeFile } from 'node:fs/promises';

const root = process.cwd();
const mode = process.argv[2] || 'walk';
const HELP = `appwalk — walk your app, understand your code
  appwalk              opens the appwalk shell (home menu)
  appwalk tree         clickable file map
  appwalk audit [--json] [--report]   secrets/clutter/duplicates/deps/git
  appwalk monitor      run the app and watch for errors
  appwalk explain <file>  AI explanation (bring your own key)
  appwalk glossary [term]
  appwalk doctor       self-check`;

const map = () => buildMap(root);

if (mode === 'doctor') {
  const v = process.versions.node.split('.')[0];
  console.log(`node: ${process.version} ${+v >= 20 ? 'OK' : 'need >= 20'}`);
  const m = await map();
  console.log(`files found: ${m.flat.length} (entry points: ${m.entryPoints.map((n) => n.name).join(', ') || 'none'})`);
  console.log(`ai: ${providerAvailable() ? 'configured (' + pickLite() + ' lite)' : 'not configured — AI explanations off (core still works)'}`);
  console.log(`repo rule: .env values are never printed by any mode`);
} else if (mode === 'tree') {
  const m = await map(); if (!m.flat.length) { console.log('appwalk: no files found.'); process.exit(0); }
  await shell(root, { screen: 'tree', map: m });
  process.exit(0);
} else if (mode === 'glossary') {
  const q = process.argv[3]; if (!q) { console.log(TERMS.map((t) => t.term).join('\n')); }
  else { const e = lookup(q); console.log(e ? renderTerm(e) : `no term "${q}". Try: appwalk glossary`); }
} else if (mode === 'explain') {
  const file = process.argv[3]; if (!file) { console.log('usage: appwalk explain <file>'); process.exit(0); }
  const text = await readFileSafe(join(root, file));
  const r = await explain(`Explain this file for a beginner:\n\n${(text || '').slice(0, 6000)}`, { lite: true });
  console.log(r.text); console.log(`\n[${r.model} · ~${r.tokens} tokens · ~$${r.costUsd.toFixed(6)}]`);
  if (!providerAvailable()) console.log('\n' + educateText());
} else if (mode === 'audit') {
  const m = await map();
  const finds = await allFindings(root, m);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(finds, null, 2));
  } else {
    console.log(`audit: ${finds.length} finding(s)`);
    for (const f of finds) {
      const where = `${f.file}${f.line ? ':' + f.line : ''}`;
      const what = f.kind === 'duplicate'
        ? `≡ ${where}  ~duplicate of ${f.other} (sim ${f.sim}) — candidates to merge`
        : `${where} ${f.label || f.reason || f.kind}${f.snippet ? ` (${f.snippet})` : ''}`;
      console.log(`  ${what}`);
    }
  }
  if (process.argv.includes('--report')) { await writeFile(join(root, 'appwalk-report.html'), renderReport({ root, map: m, finds })); console.log('  report: appwalk-report.html'); }
} else if (mode === 'monitor') {
  const m = await map();
  await monitor(root, detectStack(m), { explain: (msg) => explain(msg, { lite: true }) });
} else if (mode === 'walk' || mode === 'help' || mode === '--help') {
  if (mode === 'help' || mode === '--help') { console.log(HELP); process.exit(0); }
  await shell(root);
  process.exit(0);
} else { console.log(`appwalk: unknown mode "${mode}"\n\n${HELP}`); }
