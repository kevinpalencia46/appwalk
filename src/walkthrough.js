// src/walkthrough.js
import { basename } from 'node:path';
import { readFileSafe, rel } from './util.js';
import { findMatches } from './glossary.js';
import { fileHistory } from './history.js';

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

// The four AI model options shown as a selectable list on tour step 5. Each row
// carries its cost + one-line "good at"; the tour expands `setup` when Enter is
// pressed on the selected row. Same facts as the old educateText() wall of prose,
// restructured into a picker so a beginner reads four comparable rows, not a block.
export const MODEL_OPTIONS = [
  {
    id: 'lite',
    label: 'lite',
    cost: 'cheap & fast',
    goodAt: 'quick "what does this mean" explainers',
    setup: 'Paste your API key into .env as AI_API_KEY and set AI_PROVIDER=anthropic. Still smart, just shallower — the key stays in .env (gitignored), never commit it.',
  },
  {
    id: 'pro',
    label: 'pro',
    cost: 'most capable, costs more',
    goodAt: 'deep reasoning, hard bugs, refactors',
    setup: 'Set AI_PROVIDER=anthropic and AI_MODEL=<pro model> in .env. Costs more per answer — save it for the hard stuff, not for a one-line "what does this mean?".',
  },
  {
    id: 'local',
    label: 'local (Ollama)',
    cost: 'free · private · offline',
    goodAt: 'summaries and small asks',
    setup: 'Install Ollama from ollama.com, then run `ollama pull llama3.2:3b`. It runs entirely on your machine — free and private. Needs ~4GB+ free RAM; on a phone/low-spec laptop skip local and use lite instead.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    cost: 'no key needed',
    goodAt: 'an agent that reads AND edits your files',
    setup: 'Set AI_PROVIDER=claude-code — no key needed. Use it when you want the AI to DO things (edit files, run commands), not just talk.',
  },
];

export async function buildTour(map, stack) {
  const steps = [];
  const n = (p) => map.flat.find((x) => x.path.endsWith(p));

  const nodeApp = stack.type === 'node';
  const pythonApp = stack.type === 'python';
  const staticApp = stack.type === 'static';
  const kindWord = nodeApp ? 'Node.js' : pythonApp ? 'Python' : staticApp ? 'static site' : 'project I don\'t recognize yet';

  steps.push({
    title: 'What this app is',
    body: `I can see ${map.flat.length} files. It looks like a ${kindWord} app.\n\nThink of it like a restaurant: ${nodeApp ? '`package.json` is the menu of what it can do, `src/` is the kitchen, and the run command is how you open the doors.' : pythonApp ? 'the main script is the kitchen, the folders are your ingredients, and the run command is how you open the doors.' : staticApp ? '`index.html` is the front door — everything it points to is the rest of the building.' : 'the files are the rooms, and the README is the sign out front.'}${gloss('dependency')}`,
    files: [],
    tags: nodeApp ? ['peek'] : [],
  });

  steps.push({
    title: 'How it starts',
    body: stack.runCmd
      ? `Run it with: ${stack.runCmd}.${stack.entry ? ` The entry point is ${stack.entry} — start reading there.` : ''}\n\nThink of the run command as the ignition: it fires up everything your app needs in one go.${gloss('deploy')}`
      : 'I couldn\'t find a standard entry point. Try `appwalk tree` to explore, or add a README that says how to run it.',
    files: stack.entry ? [n(stack.entry)?.path].filter(Boolean) : [],
    tags: stack.entry ? (nodeApp || pythonApp ? ['run'] : ['peek']) : [],
  });

  const dirs = [...new Set(map.flat.map((f) => f.dir))].filter((d) => d && d !== '.').slice(0, 12);
  steps.push({
    title: 'These are your folders',
    body: dirs.length ? `Top-level folders: ${dirs.join(', ')}. Each one usually holds one job — code, config, assets. Think of folders as labeled shelves: you always know which drawer holds the thing you need.${gloss('schema')}` : 'Everything lives in the root folder for now — that\'s fine for a small app.',
    files: [],
    tags: [],
  });

  const entry = n(stack.entry || 'index.js');
  if (entry) {
    const text = (await readFileSafe(entry.path) || '').slice(0, 1200);
    const h = await fileHistory(map.root, rel(map.root, entry.path));
    const hist = h ? `\n\n(history: added ${h.firstDate}, changed ${h.commits} time(s); last: ${h.lastMessage})` : '';
    steps.push({
      title: `A look inside ${basename(entry.path)}`,
      body: `This file is ${entry.lang}, ${entry.size} bytes.${text ? `\n\n${text}\n\n` : ''}${hist}${gloss('debugging')}`,
      files: [entry.path],
      tags: nodeApp || pythonApp ? ['run'] : [],
    });
  }

  steps.push({
    title: 'Choosing your AI model (optional — free to skip)',
    body: '',            // the tour renders the selectable MODEL_OPTIONS list instead
    models: MODEL_OPTIONS,
    files: [],
    tags: [],
  });

  steps.push({
    title: 'What to watch',
    body: `Next, run \`appwalk audit\` — it checks for leaked secrets, leftover clutter, duplicate files that could be merged, and risky dependencies. Every finding is explained with a fix.${gloss('API key')}`,
    files: [],
    tags: [],
  });
  return steps;
}

export const printTour = (tour) => tour.map((s, i) => `\n[${i + 1}/${tour.length}] ${s.title}\n${s.body}`).join('\n');
