// src/walkthrough.js
import { basename } from 'node:path';
import { readFileSafe, rel } from './util.js';
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

// The four AI model options shown as a selectable list on the choose-your-model step.
// Each row carries its cost + one-line "good at"; the tour expands `setup` when Enter is
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

// The tour teaches one concept per step: short bodies, blank lines between ideas, and
// a calm one-liner at the end inviting the beginner to press g for any word they don't
// know (the glossary hint line lives in the tour renderer, not here mid-blurb).
export async function buildTour(map, stack) {
  const steps = [];
  const n = (p) => map.flat.find((x) => x.path.endsWith(p));

  const nodeApp = stack.type === 'node';
  const pythonApp = stack.type === 'python';
  const staticApp = stack.type === 'static';
  const kindWord = nodeApp ? 'Node.js' : pythonApp ? 'Python' : staticApp ? 'static site' : 'project I don\'t recognize yet';

  // Step 1 — what the app is. One idea: it's a <kind> app, and a small pause line
  // saying what that word means. Corrects the .js/JSON mix-up without explaining JSON.
  steps.push({
    title: 'What this app is',
    body: `I can see ${map.flat.length} files. It looks like a ${kindWord} app.\n\n${nodeApp
      ? 'That just means: it\'s an app written in JavaScript, and "Node" is the program that runs JavaScript outside a web browser.\n\nThe `.js` in file names stands for JavaScript — not JSON. JSON is something different, and we\'ll meet it next.'
      : pythonApp
        ? 'That just means: it\'s a program written in Python, a language that reads almost like plain English.'
        : staticApp
          ? 'That just means: it\'s a webpage — a set of files your browser reads and shows.'
          : 'I can\'t tell yet what language it\'s written in. That\'s fine — we\'ll figure it out as we go.'}`,
    files: [],
    tags: [],
  });

  // Step 2 — the app's own config. For node that's package.json: JSON first, then
  // scripts, then dependencies — each introduced on its own, never assumed known.
  if (nodeApp) {
    const pkgPath = n('package.json')?.path;
    steps.push({
      title: 'Your package.json',
      body: 'Your app has a file called package.json — it\'s a JSON file.\n\nJSON is just a way of writing settings as text — think of it as your app\'s ID card.\n\nThen there are scripts: shortcuts that run your app.\n\nAnd dependencies: libraries your app relies on — code other people wrote that you install into your project.',
      files: pkgPath ? [pkgPath] : [],
      tags: ['peek'],
    });
  } else if (pythonApp) {
    steps.push({
      title: 'Your app\'s requirements',
      body: 'Python apps list what they need in a file like requirements.txt.\n\nThose are the libraries your app relies on — code other people wrote that you install into your project.',
      files: n('requirements.txt')?.path ? [n('requirements.txt').path] : [],
      tags: [],
    });
  } else if (staticApp) {
    steps.push({
      title: 'Your index.html',
      body: 'index.html is the front door — the page your browser reads and shows first.\n\nIt\'s an HTML file: HTML is the structure every webpage is built on.',
      files: [n('index.html')?.path].filter(Boolean),
      tags: ['peek'],
    });
  } else {
    steps.push({
      title: 'What I see',
      body: 'I can\'t tell what kind of app this is yet. That\'s fine — we\'ll figure it out as we go.\n\nA README file often says how to run the app.',
      files: [],
      tags: [],
    });
  }

  // Step 3 — the folders. Introduces src properly: src stands for SOURCE, and the
  // whole app as a restaurant (menu / kitchen / dining room).
  const dirs = [...new Set(map.flat.map((f) => f.dir))].filter((d) => d && d !== '.').slice(0, 12);
  const hasSrc = dirs.includes('src');
  steps.push({
    title: 'These are your folders',
    body: !dirs.length
      ? 'Everything lives in the root folder for now — that\'s fine for a small app.'
      : hasSrc
        ? `src stands for SOURCE — it\'s where your actual code lives.\n\nThink of the whole app as a restaurant: package.json is the menu, src is the kitchen, the public folder is the dining room.\n\nYour top-level folders: ${dirs.join(', ')}.`
        : nodeApp
          ? `Think of the whole app as a restaurant: package.json is the menu, and the folders are labeled shelves — each holds one job.\n\nYour top-level folders: ${dirs.join(', ')}.`
          : pythonApp
            ? `Think of the whole app as a restaurant: the main script is the kitchen, the folders are your ingredients.\n\nYour top-level folders: ${dirs.join(', ')}.`
            : staticApp
              ? `index.html is the front door — everything it points to is the rest of the building.\n\nYour top-level folders: ${dirs.join(', ')}.`
              : `Each folder usually holds one job — code, config, assets.\n\nYour top-level folders: ${dirs.join(', ')}.`,
    files: [],
    tags: [],
  });

  // Step 4 — how it starts. One calm idea: this one command fires everything up.
  steps.push({
    title: 'How it starts',
    body: stack.runCmd
      ? `To start this app, you\'d run: ${stack.runCmd}.\n\nThat one command fires up everything your app needs at once.\n\n${stack.entry ? `The entry point is ${stack.entry} — start reading there.` : ''}`
      : 'I couldn\'t find a standard way to start it. Try `appwalk tree` to explore, or add a README that says how to run it.',
    files: stack.entry ? [n(stack.entry)?.path].filter(Boolean) : [],
    tags: nodeApp || pythonApp ? ['run'] : [],
  });

  // Step 5 — a look inside the entry file. Explain the file's role plainly first,
  // then show the start of its content. Kept short and gentle.
  const entry = n(stack.entry || 'index.js');
  if (entry) {
    const text = (await readFileSafe(entry.path) || '').slice(0, 1200);
    const h = await fileHistory(map.root, rel(map.root, entry.path));
    const hist = h ? `\n\n(history: added ${h.firstDate}, changed ${h.commits} time(s); last: ${h.lastMessage})` : '';
    const role = nodeApp
      ? 'the file that lists how to run your app and what it depends on'
      : pythonApp
        ? 'the script that starts everything — your app\'s front door'
        : staticApp
          ? 'the page your browser reads first — the front door'
          : 'a key file in your app';
    steps.push({
      title: `A look inside ${basename(entry.path)}`,
      body: `This is ${basename(entry.path)} — ${role}.\n\nHere\'s the start of it:\n\n${text ? `${text}\n` : ''}${hist}`,
      files: [entry.path],
      tags: nodeApp || pythonApp ? ['run'] : [],
    });
  }

  // Step 6 — choose your AI model. The selectable MODEL_OPTIONS list renders instead
  // of a body wall; the one-line intro keeps it calm ("AI is optional").
  steps.push({
    title: 'Choosing your AI model (optional — free to skip)',
    body: 'AI is optional — the core runs free. If you want explanations as you go, here are your choices.',
    models: MODEL_OPTIONS,
    files: [],
    tags: [],
  });

  // Step 7 — what to watch. One encouraging idea: run the audit next; it's safe.
  steps.push({
    title: 'What to watch',
    body: 'Next, run `appwalk audit` — the safety check.\n\nIt looks for leaked secrets, leftover clutter, duplicate files, and risky dependencies.\n\nEvery finding comes with a fix — I\'ll walk you through it.',
    files: [],
    tags: [],
  });
  return steps;
}

export const printTour = (tour) => tour.map((s, i) => `\n[${i + 1}/${tour.length}] ${s.title}\n${s.body}`).join('\n');
