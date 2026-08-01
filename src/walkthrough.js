// src/walkthrough.js
import { basename } from 'node:path';
import { readFileSafe, rel } from './util.js';
import { findMatches } from './glossary.js';
import { educateText } from './ai/educate.js';   // deterministic text — no AI key needed

export function detectStack(map) {
  const names = new Set(map.flat.map((n) => n.name));
  if (names.has('package.json')) {
    return { type: 'node', runCmd: 'npm run dev (or the dev script in package.json)', entry: 'package.json' };
  }
  if (names.has('main.py') || names.has('app.py') || names.has('manage.py')) {
    return { type: 'python', runCmd: 'python main.py', entry: names.has('main.py') ? 'main.py' : 'app.py' };
  }
  if (names.has('index.html')) return { type: 'static', runCmd: 'open index.html (or serve the folder)', entry: 'index.html' };
  return { type: 'unknown', runCmd: null, entry: null };
}

const gloss = (s) => {
  const hits = findMatches(s);
  return hits.length ? `\n   [terms: ${hits.join(', ')} — run \`appwalk glossary <term>\` for what they mean]` : '';
};

export async function buildTour(map, stack) {
  const steps = [];
  const n = (p) => map.flat.find((x) => x.path.endsWith(p));

  steps.push({
    title: 'What this app is',
    body: `I can see ${map.flat.length} files. It looks like a ${stack.type === 'node' ? 'Node.js' : stack.type === 'python' ? 'Python' : stack.type === 'static' ? 'static site' : 'project I don\'t recognize yet'}.${gloss('dependency')}`,
    files: [],
  });

  steps.push({
    title: 'How it starts',
    body: stack.runCmd
      ? `Run it with: ${stack.runCmd}.${stack.entry ? ` The entry point is ${stack.entry} — start reading there.` : ''}${gloss('deploy')}`
      : 'I couldn\'t find a standard entry point. Try `appwalk tree` to explore, or add a README that says how to run it.',
    files: stack.entry ? [n(stack.entry)?.path].filter(Boolean) : [],
  });

  const dirs = [...new Set(map.flat.map((f) => f.dir))].filter((d) => d && d !== '.').slice(0, 12);
  steps.push({
    title: 'These are your folders',
    body: dirs.length ? `Top-level folders: ${dirs.join(', ')}. Each one usually holds one job — code, config, assets.${gloss('schema')}` : 'Everything lives in the root folder for now — that\'s fine for a small app.',
    files: [],
  });

  const entry = n(stack.entry || 'index.js');
  if (entry) {
    const text = (await readFileSafe(entry.path) || '').slice(0, 1200);
    steps.push({
      title: `A look inside ${basename(entry.path)}`,
      body: `This file is ${entry.lang}, ${entry.size} bytes.${text ? `\n\n${text}\n\n` : ''}${gloss('debugging')}`,
      files: [entry.path],
    });
  }

  steps.push({
    title: 'Choosing your AI model (optional — free to skip)',
    body: educateText(),
    files: [],
  });

  steps.push({
    title: 'What to watch',
    body: `Next, run \`appwalk audit\` — it checks for leaked secrets, leftover clutter, duplicate files that could be merged, and risky dependencies. Every finding is explained with a fix.${gloss('API key')}`,
    files: [],
  });
  return steps;
}

export const printTour = (tour) => tour.map((s, i) => `\n[${i + 1}/${tour.length}] ${s.title}\n${s.body}`).join('\n');
