#!/usr/bin/env node
import { join } from 'node:path';
import { readFileSafe } from '../src/util.js';
import { buildMap } from '../src/tree.js';
import { shell } from '../src/tui/app.js';
import { TERMS, lookup, renderTerm } from '../src/glossary.js';
import { detectStack } from '../src/walkthrough.js';
import { allFindings, CATEGORIES, cleanCount } from '../src/audit/index.js';
import { explain, providerAvailable, pickLite } from '../src/ai/index.js';
import { educateText } from '../src/ai/educate.js';
import { monitor } from '../src/monitor.js';
import { buildFlow } from '../src/flow.js';
import { renderReport } from '../src/report.js';
import { inc as statsInc, statsPath } from '../src/stats.js';
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
const jsonOut = (data) => { console.log(JSON.stringify(data)); process.exit(0); };

if (mode === 'stack') {
  const m = await map();
  jsonOut(detectStack(m));
} else if (mode === 'doctor') {
  const v = process.versions.node.split('.')[0];
  console.log(`node: ${process.version} ${+v >= 20 ? 'OK' : 'need >= 20'}`);
  const m = await map();
  console.log(`files found: ${m.flat.length} (entry points: ${m.entryPoints.map((n) => n.name).join(', ') || 'none'})`);
  console.log(`ai: ${providerAvailable() ? 'configured (' + pickLite() + ' lite)' : 'not configured — AI explanations off (core still works)'}`);
  console.log(`repo rule: .env values are never printed by any mode`);
  // Copy-pasteable issue report (product brief §5a): fenced, masked, ends with an action.
  const issue = [
    '```',
    `OS:        ${process.platform} ${process.arch}`,
    `Node:      ${process.version}`,
    `appwalk:   ${process.env.npm_package_version || '0.1.0'}`,
    `command:   appwalk ${process.argv.slice(2).join(' ')}`,
    `cwd:       ${root}`,
    `ai key:    ${providerAvailable() ? 'configured (values never shown)' : 'not configured'}`,
    `error:     (paste the error or wrong behavior you saw)`,
    '```',
    'Copy the block above into a GitHub issue.',
  ].join('\n');
  if (process.argv.includes('--report')) {
    await writeFile(join(root, 'appwalk-doctor.txt'), issue + '\n');
    console.log('\nissue report written: appwalk-doctor.txt');
  } else {
    console.log('\n' + issue);
  }
} else if (mode === 'tree') {
  const m = await map();
  if (process.argv.includes('--json')) jsonOut({ root: m.root, hasEnv: m.hasEnv, files: m.flat.map((n) => ({ name: n.name, dir: n.dir, lang: n.lang, size: n.size, entry: !!n.entry })) });
  if (!m.flat.length) { console.log('appwalk: no files found. (FAQ: no-files-found)'); process.exit(0); }
  await shell(root, { screen: 'tree', map: m });
  process.exit(0);
} else if (mode === 'flow') {
  const m = await map();
  const s = detectStack(m);
  const f = await buildFlow(m, s, { depth: 3 });
  jsonOut(f);
} else if (mode === 'glossary') {
  const q = process.argv[3];
  if (process.argv.includes('--json')) jsonOut(TERMS);
  if (!q) { console.log(TERMS.map((t) => t.term).join('\n')); }
  else { const e = lookup(q); console.log(e ? renderTerm(e) : `no term "${q}". Try: appwalk glossary (FAQ: glossary)`); }
} else if (mode === 'explain') {
  const file = process.argv[3]; if (!file) { console.log('usage: appwalk explain <file> (FAQ: usage)'); process.exit(0); }
  statsInc('ran_explain');
  const text = await readFileSafe(join(root, file));
  const r = await explain(`Explain this file for a beginner:\n\n${(text || '').slice(0, 6000)}`, { lite: true });
  if (process.argv.includes('--json')) jsonOut({ file, text: r.text, role: r.role });
  console.log(r.text); console.log(`\n[${r.model} · ~${r.tokens} tokens · ~$${r.costUsd.toFixed(6)}]`);
  if (!providerAvailable()) console.log('\n' + educateText());
} else if (mode === 'audit') {
  const m = await map();
  const finds = await allFindings(root, m);
  if (process.argv.includes('--report')) statsInc('ran_audit_report');
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(finds, null, 2));
  } else {
    console.log(`audit: ${cleanCount(finds)} of ${CATEGORIES.length} clean (${finds.length} finding${finds.length === 1 ? '' : 's'})`);
    for (const f of finds) {
      const where = `${f.file}${f.line ? ':' + f.line : ''}`;
      const what = f.kind === 'duplicate'
        ? `≡ ${where}  ~duplicate of ${f.other} (sim ${f.sim}) — candidates to merge`
        : `${where} ${f.label || f.reason || f.kind}${f.snippet ? ` (${f.snippet})` : ''}`;
      console.log(`  ${what}`);
      console.log(`    — fix: ${f.fix || 'review this finding and remove the risk'}`);
    }
  }
  if (process.argv.includes('--report')) { await writeFile(join(root, 'appwalk-report.html'), renderReport({ root, map: m, finds })); console.log('  report: appwalk-report.html'); }
} else if (mode === 'monitor') {
  const m = await map();
  await monitor(root, detectStack(m), { explain: (msg) => explain(msg, { lite: true }) });
} else if (mode === 'walk' || mode === 'help' || mode === '--help') {
  if (mode === 'help' || mode === '--help') { console.log(HELP); process.exit(0); }
  statsInc(providerAvailable() ? 'configured_key' : 'skipped_key');
  await shell(root);
  process.exit(0);
} else { console.log(`appwalk: unknown mode "${mode}" (FAQ: usage)\n\n${HELP}`); }
