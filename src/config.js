// src/config.js — the "Your setup" screen's data layer.
//
// Pure, zero-dependency, no AI. Two jobs:
//   1. scanConfigFiles — teach the project's config files: for each recognized
//      file, what it controls, how THIS project has it set (real values pulled
//      from the file), why, and how it could be configured differently.
//   2. suggestFiling — project-grounded organization advice: classify every file
//      by role (the same heuristics the flow map uses) and point out real
//      groupings that could move into a folder.
//
// Safety: .env is a LOCATION, never its values. No file is written or moved.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSafe } from './util.js';
import { isConfigName, classifyRole } from './flow.js';

// ---------------------------------------------------------------------------
// The config knowledge base — ORIGINAL prose, written for this project.
// ---------------------------------------------------------------------------
const CONFIG_TYPES = {
  'package.json': {
    what: 'the ID card + instruction sheet for a Node app',
    parse(text) {
      const pkg = JSON.parse(text);
      const out = [];
      const scr = Object.keys(pkg.scripts || {});
      if (scr.length) out.push({
        key: 'scripts', value: scr.join(', '),
        why: `these are your run shortcuts — npm run ${scr[0]} starts it`,
        alternatives: 'rename them anything you like, but keep one dev command for local work',
      });
      if (pkg.type) out.push({
        key: 'type', value: pkg.type,
        why: pkg.type === 'module'
          ? "'module' means your files use the modern import/export syntax (the .js = JavaScript lesson)"
          : "'commonjs' means your files use require()",
        alternatives: "switch it — but then every file's import syntax must match",
      });
      const deps = Object.keys(pkg.dependencies || {});
      if (deps.length) out.push({
        key: 'dependencies', value: `${deps.length}${deps[0] ? ` (${deps.slice(0, 3).join(', ')})` : ''}`,
        why: 'libraries your app needs at run time',
        alternatives: 'a dep only used while building belongs in devDependencies instead',
      });
      const dev = Object.keys(pkg.devDependencies || {});
      if (dev.length) out.push({
        key: 'devDependencies', value: `${dev.length}${dev[0] ? ` (${dev.slice(0, 3).join(', ')})` : ''}`,
        why: 'only used while developing or building, not at run time',
        alternatives: 'add one with npm install -D <pkg>',
      });
      if (pkg.main) out.push({
        key: 'main', value: pkg.main,
        why: 'the file Node loads first when this package is required',
        alternatives: 'point it at any file you like',
      });
      return out;
    },
  },
  env: {
    what: 'where your secrets live — keys and URLs your app reads at run time',
    note: 'appwalk shows this file only as a location — its values are never read, displayed, or sent anywhere.',
  },
  tsconfig: {
    what: 'TypeScript settings — how strictly the compiler checks your code',
    parse(text) {
      const c = (() => { try { return JSON.parse(text).compilerOptions || {}; } catch { return {}; } })();
      const out = [];
      if (c.strict !== undefined) out.push({
        key: 'strict', value: String(c.strict),
        why: c.strict ? 'strict mode makes TypeScript catch more mistakes for you' : 'strict mode is off, so the compiler lets more slip through',
        alternatives: 'flip it and fix the few errors it reveals — usually worth it',
      });
      if (c.target) out.push({
        key: 'target', value: c.target,
        why: 'which JavaScript version the compiled code targets (newer = more modern syntax, older = runs on more devices)',
        alternatives: 'bump it when you control the devices it runs on',
      });
      return out;
    },
  },
  vite: {
    what: 'the dev server + build settings for a Vite app',
    note: 'this file controls the port, the build output folder, and any plugins. Change a value here and restart the dev server to see it take effect.',
  },
  docker: {
    what: 'the recipe for building a container that runs your app',
    note: 'read it top to bottom: the base image, then the setup steps, then the command that actually runs your app.',
  },
  gitignore: {
    what: 'the list of files git should never track',
    note: 'node_modules and .env should always be in here — the Audit screen checks it for you.',
  },
  next: {
    what: 'Next.js app settings',
    note: 'mostly framework tuning (strict mode, image settings, redirects). Most defaults are fine to leave alone.',
  },
  eslint: {
    what: 'code-quality rules for the linter',
    note: 'rules that flag bugs and bad style as you code. Turning a rule off is fine if it fights your style — but read why it exists first.',
  },
  'python-deps': {
    what: 'the list of Python libraries your project installs',
    note: 'a Python sibling of package.json — install a package and pin its version here so the app works on any machine.',
  },
  makefile: {
    what: 'shortcuts for running common tasks',
    note: 'each line is target: commands. Running make <target> executes that command — like scripts in package.json.',
  },
  'docker-compose': {
    what: 'how multiple containers run together',
    note: 'defines the services (app, database, …) and their connections. One command starts the whole stack.',
  },
  tailwind: {
    what: 'Tailwind CSS styling settings',
    note: 'tells Tailwind which files to scan for class names and lets you extend the default palette.',
  },
  postcss: {
    what: 'the CSS processing pipeline settings',
    note: 'a list of plugins that transform your CSS before it ships.',
  },
  babel: {
    what: 'how newer JavaScript is converted to run everywhere',
    note: 'lets you write modern syntax even when the target environment is older. Most setups are automatic now.',
  },
  generic: {
    what: 'a settings file for this project',
    note: "appwalk can see this is config but doesn't have a built-in lesson for it yet. The pattern is the same: something in your project reads it at startup and changes behavior.",
  },
};

// filename -> kind, checked in this order. package.json is handled explicitly.
const KIND_BY_NAME = [
  [/^tsconfig(\.json)?$/, 'tsconfig'],
  [/^vite\.config\./, 'vite'],
  [/^(Dockerfile|Containerfile)$/, 'docker'],
  ['.gitignore', 'gitignore'],
  [/^next\.config\./, 'next'],
  [/^(eslint\.config\.|\.eslintrc)/, 'eslint'],
  [/^(requirements\.txt|Pipfile|pyproject\.toml)$/, 'python-deps'],
  ['Makefile', 'makefile'],
  [/^docker-compose/, 'docker-compose'],
  [/^tailwind\.config\./, 'tailwind'],
  [/^postcss\.config\./, 'postcss'],
  [/^(babel\.config\.|\.babelrc)/, 'babel'],
];
const kindOf = (name) => {
  for (const [pat, kind] of KIND_BY_NAME) {
    if (pat instanceof RegExp ? pat.test(name) : pat === name) return kind;
  }
  return 'generic';
};
// buildMap sets dir:'' for root files (relative(root, root) === ''), never '.'
const relOf = (node) => (!node.dir || node.dir === '.' ? node.name : `${node.dir}/${node.name}`);

const card = (path, name, kind, settings = [], note) => ({
  path, name, kind,
  what: CONFIG_TYPES[kind]?.what || CONFIG_TYPES.generic.what,
  settings,
  ...(note ? { note } : {}),
});

async function cardFor(node, kind) {
  const text = await readFileSafe(node.path);
  const def = CONFIG_TYPES[kind] || CONFIG_TYPES.generic;
  if (!def.parse) return card(node.path, node.name, kind, [], def.note);
  try {
    return card(node.path, node.name, kind, def.parse(text || ''), def.note);
  } catch {
    const note = kind === 'package.json'
      ? "couldn't parse this package.json — it's not valid JSON. Check for missing commas or quotes (npm init -y recreates it)."
      : `couldn't parse this file yet — its format isn't JSON. appwalk still knows it's config.`;
    return card(node.path, node.name, kind, [], note);
  }
}

// probe dotfiles that walk() (src/util.js) skips, so the settings screen still
// teaches the ones that matter: .env, .gitignore, .eslintrc*
const DOT_PROBES = ['.gitignore', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.babelrc'];
const DOT_KINDS = { '.gitignore': 'gitignore', '.eslintrc': 'eslint', '.eslintrc.json': 'eslint', '.eslintrc.js': 'eslint', '.babelrc': 'babel' };

export async function scanConfigFiles(map, _stack = {}) {
  const files = [];
  const pkg = map.flat.find((n) => n.name === 'package.json');
  if (pkg) files.push(await cardFor(pkg, 'package.json'));
  if (map.hasEnv) files.push(card(join(map.root, '.env'), '.env', 'env', [], CONFIG_TYPES.env.note));
  for (const dot of DOT_PROBES) {
    if (existsSync(join(map.root, dot))) {
      files.push(card(join(map.root, dot), dot, DOT_KINDS[dot], [], CONFIG_TYPES[DOT_KINDS[dot]].note));
    }
  }
  for (const n of map.flat) {
    if (n.name === 'package.json' || !isConfigName(n.name)) continue;
    const kind = kindOf(n.name);
    if (kind === 'generic') files.push(card(n.path, n.name, 'generic', [], CONFIG_TYPES.generic.note));
    else files.push(await cardFor(n, kind));
  }
  return { files };
}

// ---------------------------------------------------------------------------
// Clean-filing: role-grouped organization suggestions grounded in THIS project.
// ---------------------------------------------------------------------------

const ROLE_LABELS = {
  entry: 'Entry', route: 'Route wiring', handler: 'Route handlers',
  data: 'Data', render: 'Render / UI', util: 'Helpers', config: 'Config',
};
// Which roles are worth grouping. entry is one file; config (package.json etc.)
// conventionally lives at root and tooling depends on it — leave those alone.
const GROUP_ROLES = new Set(['route', 'handler', 'data', 'render', 'util']);
const FOLDER_FOR = { route: 'routes/', handler: 'routes/', data: 'data/', render: 'ui/', util: 'lib/' };
const SHOW_FILES = 6;

const ROLE_SNIFF_RE = /\.(js|jsx|ts|tsx|py)$/;
const SMALL_READ = 4096; // bounded prefix read for the code smell — a huge app isn't fully re-scanned

export async function suggestFiling(map) {
  const byRole = new Map();
  for (const n of map.flat) {
    const rel = relOf(n);   // relOf is defined in Task 2 (src/config.js)
    // name/path first; only read a bounded prefix of code files for the smell
    const text = ROLE_SNIFF_RE.test(n.name) ? (await readFileSafe(n.path))?.slice(0, SMALL_READ) || '' : '';
    const role = classifyRole(n.name, n.path, rel, text);
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(n);
  }
  const groups = [];
  for (const [role, files] of byRole) {
    if (!GROUP_ROLES.has(role) || files.length < 3) continue;
    const dirs = new Set(files.map((f) => (!f.dir || f.dir === '.' ? '(root)' : f.dir)));
    const shown = files.slice(0, SHOW_FILES).map((f) => ({ rel: relOf(f), name: f.name }));
    const label = ROLE_LABELS[role] || role;
    if (dirs.size > 1) {
      groups.push({
        role, label, files: shown,
        suggestion: `these ${files.length} are spread across ${dirs.size} folders — a ${FOLDER_FOR[role]} folder would group them`,
        note: null,
      });
    } else {
      groups.push({
        role, label, files: shown,
        suggestion: null,
        note: `already grouped together in ${[...dirs][0]} — good`,
      });
    }
  }
  // deterministic order: the way a reader scans a tree — data, then handlers, then UI
  const order = { data: 0, handler: 1, route: 2, render: 3, util: 4 };
  groups.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
  return {
    groups,
    tips: [
      'Keep the entry file at the root so it is the first thing you see.',
      'Name files by their job (routes.js), not their order (file2.js).',
      'One job per file — a file that renders AND reads the database is hard to follow.',
      'Group by layer (routes/, data/, ui/) or by feature — pick one and stay consistent.',
      'Never track secrets — the Audit screen checks .env and .gitignore.',
    ],
  };
}
