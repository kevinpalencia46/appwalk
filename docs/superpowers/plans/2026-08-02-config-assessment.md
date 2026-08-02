# "Your setup" — Config Assessment + Grounded Clean-Filing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7th home screen — "Your setup" — that teaches each config file in *this* project (what it controls · how yours is set · why · you could also…) and gives project-grounded filing advice (role-grouped suggestions off the flow heuristics, plus tips and a clutter pointer).

**Architecture:** Pure zero-dep data layer `src/config.js` (`scanConfigFiles` + `suggestFiling`) reusing flow's `isConfigName`/`classifyRole`; a pure render/step screen `src/tui/config.js` with two views (1 Settings list+detail, 2 Clean it up); the shell wires it as a 7th home button, building config data lazily and memoizing on `data.config` (the `ensureFlow` pattern).

**Tech Stack:** Node ≥20, ESM, zero runtime deps, `node --test` + `assert/strict`, hand-written ANSI TUI (`src/tui/kit.js`). No AI.

## Global Constraints

- Node >=20, ESM (`"type": "module"`), **zero runtime deps** — only `node:` builtins + project modules.
- **`.env` is a location, never its values** — no value text ever renders, and none may enter an AI call. Enforced by tests.
- **Read-only**: the tool never writes, moves, or deletes a file. Filing advice is suggestions only.
- Pure `render`/`step` per screen; the only I/O lives in `src/tui/app.js`'s loop.
- **Never crash on weird input**: unknown config files and unparseable config render cards, not errors.
- Config data is built **lazily** and memoized on `data.config` so the home menu never stalls.
- Every commit ends with the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.
- Menu glyphs are single-width box/arrow chars — never astral-plane emoji.
- All prose in the config knowledge base is **original** — never copied from docs.

---

### Task 1: Export `isConfigName` + `classifyRole` from `src/flow.js`

**Files:**
- Modify: `src/flow.js` (export `isConfigName`, add `classifyRole`, delegate `roleOf`)
- Create: `test/flow-classify.test.js`

**Interfaces:**
- Consumes: the existing regexes already in `src/flow.js` (`isConfigName`, `ROUTE_FILE_RE`, `ROUTE_CODE_RE`, `HANDLER_NAME_RE`, `CONTROLLER_RE`, `DATA_RE`, `RENDER_RE`).
- Produces:
  - `export function isConfigName(name)` — unchanged behavior, now importable.
  - `export function classifyRole(name, path, rel, text = '', opts = {}) -> 'entry'|'route'|'handler'|'data'|'render'|'config'|'util'` — `opts: { isStart?, isHandler? }`.
  - `roleOf` internally becomes `classifyRole(...)` — behavior-preserving.

- [ ] **Step 1: Write the failing test**

`test/flow-classify.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRole, isConfigName } from '../src/flow.js';

test('isConfigName recognizes the config shapes the flow map uses', () => {
  for (const ok of ['package.json', 'tsconfig.json', 'vite.config.ts', '.gitignore', 'Dockerfile', 'Makefile', 'requirements.txt', 'eslint.config.js', 'next.config.mjs', 'weird.yml'])
    assert.equal(isConfigName(ok), true, `${ok} should be config`);
  for (const no of ['index.js', 'db.js', 'routes.js', 'README.md', 'app.html'])
    assert.equal(isConfigName(no), false, `${no} should NOT be config`);
});

test('classifyRole: name/path-based roles', () => {
  assert.equal(classifyRole('index.js', '/p/index.js', 'index.js'), 'util');
  assert.equal(classifyRole('db.js', '/p/db.js', 'db.js'), 'data');
  assert.equal(classifyRole('users.js', '/p/api/users.js', 'api/users.js'), 'util');
  assert.equal(classifyRole('users.js', '/p/api/routes.js', 'api/routes.js'), 'route', 'route in the name');
  assert.equal(classifyRole('component.js', '/p/ui/component.js', 'ui/component.js'), 'render');
  assert.equal(classifyRole('package.json', '/p/package.json', 'package.json'), 'config');
});

test('classifyRole: entry/config override everything; code smell catches route wiring', () => {
  assert.equal(classifyRole('db.js', '/p/db.js', 'db.js', '', { isStart: true }), 'entry');
  assert.equal(classifyRole('package.json', '/p/package.json', 'package.json', '', { isStart: true }), 'entry');
  assert.equal(classifyRole('helpers.js', '/p/helpers.js', 'helpers.js', 'const app = express(); app.get("/x", h);'), 'route');
  assert.equal(classifyRole('helpers.js', '/p/helpers.js', 'helpers.js', 'module.exports = () => 1;'), 'util');
  assert.equal(classifyRole('x.js', '/p/x.js', 'handlers/x.js'), 'handler', 'controller dir marks handler');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/flow-classify.test.js`
Expected: FAIL — `isConfigName` and `classifyRole` are not exported (import error or `is not a function`).

- [ ] **Step 3: Refactor `src/flow.js`**

Change the private `function isConfigName(name)` (line 62) to an exported function, and add `classifyRole` + delegate `roleOf` to it (lines 161-171):

```js
export function isConfigName(name) {
  return /(^package\.json$|\.json$|\.ya?ml$|\.toml$|^\.env|\.env$|\.config\.[jt]s$|^tsconfig\.|^vite\.config\.|^Dockerfile$|^Makefile$|^requirements\.txt$|^\.gitignore$|^eslint|^babel\.|^postcss\.|^tailwind\.|^next\.config\.)/.test(name);
}

// Role of a file, shared by the flow map (src/flow.js) and the config screen's
// clean-filing suggestions (src/config.js). Best-effort, name/path first, then a
// code smell. flow.js passes isStart/isHandler from its scan context; config.js
// calls it without them and gets a name/path/smell guess.
export function classifyRole(name, path, rel, text = '', opts = {}) {
  if (opts.isStart) return 'entry';
  if (isConfigName(name)) return 'config';
  if (ROUTE_FILE_RE.test(name) || ROUTE_CODE_RE.test(text || '')) return 'route';
  if (opts.isHandler || HANDLER_NAME_RE.test(name) || CONTROLLER_RE.test(rel || '')) return 'handler';
  if (DATA_RE.test(rel || '')) return 'data';
  if (RENDER_RE.test(rel || '') || /\.(jsx|tsx|html)$/.test(path)) return 'render';
  return 'util';
}
```

And replace the whole `roleOf` function body with:

```js
function roleOf({ path, name, rel, text, isStart }, handlerRefs) {
  return classifyRole(name, path, rel, text, { isStart, isHandler: handlerRefs.has(path) });
}
```

(`ROUTE_FILE_RE`, `ROUTE_CODE_RE`, `HANDLER_NAME_RE`, `CONTROLLER_RE`, `DATA_RE`, `RENDER_RE` stay declared above `classifyRole` — move their declaration up only if the file layout demands it; they are currently declared at lines 55-60, before `roleOf`, so no move is needed.)

- [ ] **Step 4: Run the new test + the whole suite**

Run: `node --test test/flow-classify.test.js`
Expected: PASS (all 3 tests).

Run: `npm test`
Expected: 124 pass, 0 fail — the refactor is behavior-preserving.

- [ ] **Step 5: Commit**

```bash
git add src/flow.js test/flow-classify.test.js
git commit -m "$(cat <<'EOF'
refactor: export isConfigName + classifyRole for the config screen

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `scanConfigFiles` data layer (`src/config.js`)

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`

**Interfaces:**
- Consumes: `isConfigName` from `../src/flow.js`; `readFileSafe` from `../src/util.js`; `existsSync` from `node:fs`; `join` from `node:path`. `map` from `buildMap(root)` — `{ root, flat: [{ path, name, dir, ... }], hasEnv }`.
- Produces:
  - `export async function scanConfigFiles(map, _stack = {}) -> Promise<{ files: ConfigFile[] }>`
  - `ConfigFile = { path, name, kind, what, settings: Setting[], note? }`, `Setting = { key, value, why, alternatives }`.

- [ ] **Step 1: Write the failing tests**

`test/config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { scanConfigFiles } from '../src/config.js';

// ESM-safe dirname (no require): a bare "a.js" stays in root, "handlers/a.js" nests.
const dirname = (p) => p.split('/').slice(0, -1).join('/') || '.';
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'cfg-'));
  for (const [p, txt] of Object.entries(files)) {
    await mkdir(join(root, dirname(p)), { recursive: true });
    await writeFile(join(root, p), txt);
  }
  return root;
}
const has = (files, name) => files.find((f) => f.name === name);
const setting = (file, key) => file.settings.find((s) => s.key === key);

test('package.json is first and pulls the real settings with why + alternatives', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'x', type: 'module', scripts: { dev: 'vite' }, dependencies: { react: '^18' } }),
    'index.js': "import React from 'react';",
  });
  const { files } = await scanConfigFiles(await buildMap(root));
  assert.equal(files[0].kind, 'package.json', 'package.json sorts first');
  const pkg = has(files, 'package.json');
  assert.equal(setting(pkg, 'type').value, 'module');
  assert.match(setting(pkg, 'type').why, /import/i);
  assert.ok(setting(pkg, 'type').alternatives.length > 0);
  assert.match(setting(pkg, 'scripts').value, /dev/);
  assert.ok(setting(pkg, 'dependencies').value.includes('react'));
});

test('tsconfig strict is explained', async () => {
  const root = await fixture({ 'package.json': '{}', 'tsconfig.json': '{"compilerOptions":{"strict":true,"target":"ES2022"}}' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const ts = has(files, 'tsconfig.json');
  assert.equal(setting(ts, 'strict').value, 'true');
  assert.match(setting(ts, 'strict').why, /catch/i);
});

test('.env card is location-only — its value never appears anywhere in the output', async () => {
  const root = await fixture({ '.env': 'SUPER_SECRET_VALUE_123=abc', 'package.json': '{}' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const env = has(files, '.env');
  assert.ok(env, '.env appears as a card');
  const blob = JSON.stringify(files);
  assert.doesNotMatch(blob, /SUPER_SECRET_VALUE_123/, 'the .env value must never leak into config output');
  assert.doesNotMatch(blob, /abc/, 'even a short value string must not leak');
  assert.match(env.note, /never/i);
});

test('unknown config file gets a generic card, never skipped, never crashes', async () => {
  const root = await fixture({ 'package.json': '{}', 'weird.yml': 'key: value\n' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const w = has(files, 'weird.yml');
  assert.ok(w, 'unknown config is still shown');
  assert.equal(w.kind, 'generic');
  assert.match(w.what, /settings file/i);
});

test('malformed package.json renders a couldn-t-parse card, no throw', async () => {
  const root = await fixture({ 'package.json': '{ oops not json', 'index.js': '// hi' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const pkg = has(files, 'package.json');
  assert.ok(pkg, 'the card still exists');
  assert.match(pkg.note, /couldn.t parse/i);
});

test('.gitignore card appears even though walk() skips dotfiles', async () => {
  const root = await fixture({ 'package.json': '{}', '.gitignore': 'node_modules\n.env\n' });
  const { files } = await scanConfigFiles(await buildMap(root));
  assert.ok(has(files, '.gitignore'), 'gitignore probed directly');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 3: Implement `src/config.js`**

```js
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
import { isConfigName } from './flow.js';

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
// buildMap sets dir='' for root files (rel(root, root)), NOT '.', so treat an
// empty or '.' dir as root: no leading slash on the rel, and the (root) label.
const relOf = (node) => (node.dir && node.dir !== '.' ? `${node.dir}/${node.name}` : node.name);

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
```

Note: the env card is intentionally built with `card(...)` (no parse), so it can never surface file contents.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: PASS (6 tests).

Run: `npm test`
Expected: 130 pass, 0 fail (124 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "$(cat <<'EOF'
feat: config scan — teach each config file (what/how/why/alternatives)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `suggestFiling` data layer (`src/config.js` append)

**Files:**
- Modify: `src/config.js` (append `suggestFiling` + its helpers)
- Create: `test/config-filing.test.js`

**Interfaces:**
- Consumes: `classifyRole` from `../src/flow.js` (Task 1); `readFileSafe` from `../src/util.js`; `map` from `buildMap`.
- Produces:
  - `export async function suggestFiling(map) -> Promise<{ groups: FilingGroup[], tips: string[] }>`
  - `FilingGroup = { role, label, files: Array<{ rel, name }>, suggestion: string|null, note: string|null }`

- [ ] **Step 1: Write the failing tests**

`test/config-filing.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { suggestFiling } from '../src/config.js';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'filing-'));
  for (const [p, txt] of Object.entries(files)) {
    await mkdir(join(root, p.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    await writeFile(join(root, p), txt);
  }
  return root;
}
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const groupFor = (groups, role) => groups.find((g) => g.role === role);

test('scattered route handlers produce a routes/ suggestion', async () => {
  // Bare a.js/b.js/c.js classify as util (classifyRole has no flow handlerRefs);
  // a *.handler.js name is what the exported classifier recognizes as 'handler'.
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "import a from './api/a.handler.js'; import b from './routes/b.handler.js'; import c from './c.handler.js';",
    'api/a.handler.js': 'export default (req, res) => {};',
    'routes/b.handler.js': 'export default (req, res) => {};',
    'c.handler.js': 'export default (req, res) => {};',
  });
  const { groups } = await suggestFiling(await buildMap(root));
  const handlers = groupFor(groups, 'handler');
  assert.ok(handlers, '3+ files of a role group into a suggestion');
  assert.ok(handlers.files.length >= 3);
  assert.match(handlers.suggestion, /routes\//, 'suggests a routes/ folder for scattered handlers');
});

test('already-grouped files get a good note, not a suggestion', async () => {
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "import h from './handlers/a.handler.js'; import g from './handlers/b.handler.js'; import f from './handlers/c.handler.js';",
    'handlers/a.handler.js': 'export default () => {};',
    'handlers/b.handler.js': 'export default () => {};',
    'handlers/c.handler.js': 'export default () => {};',
  });
  const { groups } = await suggestFiling(await buildMap(root));
  const handlers = groupFor(groups, 'handler');
  assert.ok(handlers);
  assert.equal(handlers.suggestion, null);
  assert.match(handlers.note, /good/i);
});

test('fewer than 3 files of a role produce no group', async () => {
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "import a from './a.handler.js'; import b from './b.handler.js';",
    'a.handler.js': 'export default () => {};',
    'b.handler.js': 'export default () => {};',
  });
  const { groups } = await suggestFiling(await buildMap(root));
  assert.equal(groups.some((g) => g.role === 'handler'), false, '2 handlers is below the threshold — no noise');
});

test('express route wiring is caught by the code smell even without a route name', async () => {
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "const app = require('express')();\napp.get('/', (req, res) => res.send('hi'));",
    'api/users.js': "const router = require('express').Router();\nrouter.get('/users', (req, res) => res.send([]));",
    'routes/posts.js': "const router = require('express').Router();\nrouter.post('/posts', (req, res) => res.send({}));",
  });
  const { groups } = await suggestFiling(await buildMap(root));
  const routes = groupFor(groups, 'route');
  assert.ok(routes, 'route-wiring files are grouped via the code smell');
  assert.match(routes.suggestion, /routes\//);
});

test('tips are present and non-empty', async () => {
  const root = await fixture({ 'package.json': '{"main":"index.js"}', 'index.js': '// hi' });
  const { tips } = await suggestFiling(await buildMap(root));
  assert.ok(Array.isArray(tips) && tips.length >= 3, 'a small set of best-practice tips');
  assert.ok(tips.every((t) => strip(t).length > 0));
});

test('root files keep a clean rel (no leading slash) and count as (root)', async () => {
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "import a from './a.handler.js'; import b from './b.handler.js'; import c from './c.handler.js';",
    'a.handler.js': 'export default () => {};',
    'b.handler.js': 'export default () => {};',
    'c.handler.js': 'export default () => {};',
  });
  const { groups } = await suggestFiling(await buildMap(root));
  const handlers = groupFor(groups, 'handler');
  assert.ok(handlers, 'root handlers still group');
  assert.ok(handlers.files.every((f) => !f.rel.startsWith('/')), 'no leading slash on root rels');
  assert.match(handlers.note, /\(root\)/, 'the root directory is labeled, not blank');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/config-filing.test.js`
Expected: FAIL — `suggestFiling is not a function`.

- [ ] **Step 3: Append to `src/config.js`**

```js
// ---------------------------------------------------------------------------
// Clean-filing: role-grouped organization suggestions grounded in THIS project.
// ---------------------------------------------------------------------------
import { classifyRole } from './flow.js';

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
    const dirs = new Set(files.map((f) => (f.dir && f.dir !== '.' ? f.dir : '(root)')));
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/config-filing.test.js`
Expected: PASS (5 tests).

Run: `npm test`
Expected: 135 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config-filing.test.js
git commit -m "$(cat <<'EOF'
feat: filing suggestions — role-grouped organization advice off the flow roles

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The "Your setup" screen (`src/tui/config.js`)

**Files:**
- Create: `src/tui/config.js`
- Create: `test/tui-config.test.js`

**Interfaces:**
- Consumes: `data.config = { files: ConfigFile[], filing: { groups, tips } }` (Task 2 + Task 3 shapes); `data.findings` (memoized audit findings — optional, for the clutter pointer); kit helpers `box`, `g`, `dim`, `wrap`, `W` from `./kit.js`.
- Produces: `export const init = (params) -> state`; `export const hints`; `export function render(state, data) -> string`; `export function step(state, key, data) -> nextState | { to } | { done }`. State: `{ view: 1|2, cursor, detail: ConfigFile|null, back }`.

- [ ] **Step 1: Write the failing tests**

`test/tui-config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { scanConfigFiles, suggestFiling } from '../src/config.js';
import { init, render, step } from '../src/tui/config.js';

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

async function data(rootFiles, { hasEnv = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tuicfg-'));
  for (const [p, txt] of Object.entries(rootFiles)) {
    await mkdir(join(root, p.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    await writeFile(join(root, p), txt);
  }
  if (hasEnv) await writeFile(join(root, '.env'), 'SECRET_TOKEN=hunter2');
  const map = await buildMap(root);
  return { files: (await scanConfigFiles(map)).files, filing: await suggestFiling(map) };
}

test('view 1 renders the config file list with the package.json first', async () => {
  const config = await data({ 'package.json': '{"type":"module"}', 'tsconfig.json': '{"compilerOptions":{}}', 'index.js': '// hi' });
  const s = strip(render(init(), { config }));
  assert.match(s, /settings/i);
  assert.match(s, /package\.json/);
  assert.match(s, /tsconfig\.json/);
  assert.ok(s.indexOf('package.json') < s.indexOf('tsconfig.json'), 'package.json sorts first');
});

test('Enter opens a config detail; back returns to the list', async () => {
  const config = await data({ 'package.json': '{"type":"module"}' });
  let s = init();
  s = step(s, 'enter', { config });
  assert.ok(s.detail, 'enter opens the selected file detail');
  assert.equal(s.detail.name, 'package.json');
  const detail = strip(render(s, { config }));
  assert.match(detail, /type/);
  assert.match(detail, /module/);
  assert.match(detail, /you could also/i);
  s = step(s, 'left', { config });
  assert.equal(s.detail, null, 'back from the detail returns to the list');
});

test('the .env card never shows its value, even in detail', async () => {
  const config = await data({ 'package.json': '{}' }, { hasEnv: true });
  const list = strip(render(init(), { config }));
  assert.match(list, /\.env/);
  assert.doesNotMatch(list, /hunter2/, 'no value in the list');
  const s = step({ ...init(), cursor: 1 }, 'enter', { config }); // 0=package.json, 1=.env
  const detail = strip(render(s, { config }));
  assert.doesNotMatch(detail, /hunter2/, 'no value in the detail either');
});

test('view 2 renders filing groups, tips, and a clutter pointer', async () => {
  // scattered *.handler.js files -> a real suggestion branch (not the static tip)
  const config = await data({
    'package.json': '{"main":"index.js"}',
    'index.js': "import a from './api/a.handler.js'; import b from './routes/b.handler.js'; import c from './c.handler.js';",
    'api/a.handler.js': 'export default (req, res) => {};',
    'routes/b.handler.js': 'export default (req, res) => {};',
    'c.handler.js': 'export default (req, res) => {};',
  });
  let s = step(init(), '2', { config });
  assert.equal(s.view, 2, '2 switches to Clean it up');
  const out = strip(render(s, { config, findings: [{ file: 'x', kind: 'bak', category: 'clutter' }] }));
  assert.match(out, /clean/i);
  assert.match(out, /Route handlers/, 'the group label renders');
  assert.match(out, /would group them/, 'the group suggestion renders, not just the static tip');
  assert.match(out, /clutter/i, 'the clutter pointer renders when findings exist');
  // switching back works
  assert.equal(step(s, '1', { config }).view, 1);
});

test('q backs out; the screen degrades gracefully with no config data', () => {
  assert.deepEqual(step(init(), 'q', {}), { to: 'home' });
  assert.deepEqual(step(init({ back: 'tree' }), 'q', {}), { to: 'tree' });
  const s = strip(render(init(), {}));
  assert.match(s, /no config/i, 'no config data renders a friendly empty state');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/tui-config.test.js`
Expected: FAIL — `Cannot find module '../src/tui/config.js'`.

- [ ] **Step 3: Implement `src/tui/config.js`**

```js
// src/tui/config.js — the "Your setup" screen.
//
// Two views, switched by 1 / 2:
//   View 1 (Settings) — the project's config files as a list; Enter opens a
//     detail card (what it controls · how yours is set · why · you could also…).
//   View 2 (Clean it up) — role-grouped filing suggestions grounded in THIS
//     project, plus best-practice tips and a pointer to the clutter audit.
//
// Pure render/step — data comes from data.config (lazy-built + memoized by the
// shell) so the screen never does I/O.
import { box, g, dim, wrap, W } from './kit.js';

export const init = (params = {}) => ({ view: 1, cursor: 0, detail: null, back: params.back || 'home' });
export const hints = '1 settings · 2 clean up · ↑↓ move · Enter open · q back';

function detailLines(file) {
  const lines = [`  ${g(file.what)}`];
  for (const s of file.settings || []) {
    lines.push('', `  ${g(s.key)}: ${s.value}`);
    lines.push(`      why: ${s.why}`);
    lines.push(`      you could also: ${s.alternatives}`);
  }
  if (file.note) lines.push('', `  ${dim(file.note)}`);
  return lines.flatMap((l) => (l ? wrap(l, Math.max(30, W() - 8)) : ['']));
}

function renderSettings(state, cfg) {
  const files = cfg.files || [];
  if (!files.length) return box('Your setup — settings', ['', '  No config files found.', '', '  (most projects have at least a package.json', '  or a .gitignore)', ''], { width: 'full' });
  if (state.detail) {
    return box(`Your setup — ${state.detail.name}`, ['', ...detailLines(state.detail), ''], { width: 'full' });
  }
  const cursor = Math.min(state.cursor, Math.max(0, files.length - 1));
  const rows = files.map((f, i) => `  ${i === cursor ? g('▶') : ' '}  ${g(f.name)}${dim(' — ' + f.what.slice(0, 40))}`);
  return box('Your setup — settings', ['', ...rows, ''], { width: 'full' });
}

function renderClean(cfg, findings) {
  const { groups = [], tips = [] } = cfg.filing || {};
  const clutter = (findings || []).filter((f) => f.category === 'clutter').length;
  const lines = [];
  if (!groups.length) {
    lines.push('  Nothing to tidy — every role is already one folder or under 3 files.', '');
  }
  for (const grp of groups) {
    lines.push(`  ${g('▶')} ${g(grp.label)} — ${grp.suggestion || grp.note}`);
    for (const f of grp.files) lines.push(`     ${dim(f.rel)}`);
    lines.push('');
  }
  lines.push(`  ${g('Keep it tidy')}`);
  for (const t of tips) lines.push(`   • ${dim(t)}`);
  lines.push('');
  lines.push(clutter > 0
    ? `  ${dim(`${clutter} clutter finding${clutter === 1 ? '' : 's'} — open the Audit screen for the specifics.`)}`
    : `  ${dim('No clutter findings — the Audit screen checks backups, empty folders and TODO files.')}`);
  return box('Your setup — clean it up', lines, { width: 'full' });
}

export function render(state, data = {}) {
  const cfg = data.config;
  if (!cfg) return box('Your setup', ['', '  No config data yet.', ''], { width: 'full' });
  return state.view === 2 ? renderClean(cfg, data.findings) : renderSettings(state, cfg);
}

export function step(state, key, data = {}) {
  const files = (data.config?.files) || [];
  const max = Math.max(0, files.length - 1);
  if (state.detail) {
    if (key === 'left' || key === 'q') return { ...state, detail: null };
    return state;
  }
  if (key === '1') return { ...state, view: 1 };
  if (key === '2') return { ...state, view: 2 };
  if (state.view === 2) {
    if (key === 'q') return state.back ? { to: state.back } : { done: true };
    return state;
  }
  if (key === 'down') return { ...state, cursor: Math.min(max, state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'enter' && files.length) return { ...state, detail: files[Math.min(state.cursor, max)] };
  if (key === 'q') return state.back ? { to: state.back } : { done: true };
  return state;
}
```

Note: `grp.files` is already capped at 6 by `suggestFiling` — the render shows exactly what's in the group.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/tui-config.test.js`
Expected: PASS (5 tests).

Run: `npm test`
Expected: 140 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/tui/config.js test/tui-config.test.js
git commit -m "$(cat <<'EOF'
feat: "Your setup" screen — settings list+detail and clean-it-up views

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire the 7th home button + 3×3 grid + shell route

**Files:**
- Modify: `src/tui/home.js` (7th button, `COLS = 3`, 3-across render)
- Modify: `src/tui/app.js` (config screen import, `ensureConfig`, route handling)
- Modify: `test/tui-home.test.js` (7 buttons, 3×3 nav)

**Interfaces:**
- Consumes: `scanConfigFiles`, `suggestFiling` from `../config.js`; the screen module `./config.js`; `SCREENS` registry; `ITEMS` array.
- Produces: home button `{ to: 'config', icon: '▣', label: 'Your setup', desc: 'See your settings & tidy the tree' }`; shell builds `data.config` lazily on entering the config screen (memoized), exactly like `ensureFlow`.

- [ ] **Step 1: Update the home tests to fail first**

In `test/tui-home.test.js`, change the render test's title/count to expect **7** buttons and the new button text, and replace the grid-nav test with the 3×3 expectations:

```js
test('home render shows the project name and 7 framed buttons (no mascot)', () => {
  const s = render(init(), { root: '/home/ren/great-pacific' });
  assert.match(s, /appwalk/);
  assert.match(s, /GREAT-PACIFIC/);
  assert.match(s, /Take the guided tour/);
  assert.match(s, /Your setup/, 'the 7th button renders');
  assert.match(s, /See your settings & tidy the tree/);
  const tops = strip(s).match(/┌─+┐/g) || [];
  assert.equal(tops.length, 7, 'seven button frames render, not a list');
  assert.doesNotMatch(s, /o   o/, 'the ASCII duck is gone');
  assert.doesNotMatch(s, /🚶|🗂|🛡|💬|📖/, 'no emoji in the home menu');
  assert.match(s, /→|▸|!|\?|»|↦|▣/, 'menu icons are ASCII/box-drawing glyphs');
});

test('home step: 3×3 grid — 2D arrows, empty cells clamp, no phantom slot', () => {
  let s = init();
  assert.equal(step(s, 'right').c, 1, 'right moves across row 0');
  assert.equal(step(s, 'right').c, 2);
  assert.equal(step(s, 'down').r, 1);
  assert.equal(step({ r: 1, c: 2 }, 'down').r, 2, 'down from the flow button lands on config');
  assert.equal(step({ r: 1, c: 2 }, 'down').c, 0, '…at the left, skipping the empty cells');
  assert.equal(step({ r: 2, c: 0 }, 'down').r, 0, 'bottom wraps to top');
  assert.equal(step({ r: 0, c: 0 }, 'up').r, 2, 'top wraps to bottom');
  assert.equal(step({ r: 2, c: 0 }, 'right').c, 0, 'right past the empty cells wraps in place');
  assert.deepEqual(step({ r: 0, c: 0 }, 'enter'), { to: 'tour' });
  assert.deepEqual(step({ r: 0, c: 2 }, 'enter'), { to: 'audit' });
  assert.deepEqual(step({ r: 1, c: 2 }, 'enter'), { to: 'flow' });
  assert.deepEqual(step({ r: 2, c: 0 }, 'enter'), { to: 'config' });
  assert.deepEqual(step(init(), 'q'), { done: true });
});
```

Replace the whole old `home render shows…` and `home step: 2D arrows…` tests with these two (keep the celebrate test as-is).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/tui-home.test.js`
Expected: FAIL — 6 button tops found (not 7), and grid-nav expectations mismatch.

- [ ] **Step 3: Update `src/tui/home.js`**

Add the 7th item to `ITEMS`:

```js
export const ITEMS = [
  { to: 'tour', icon: '→', label: 'Take the guided tour', desc: 'Walk your app step by step' },
  { to: 'tree', icon: '▸', label: 'Explore your files', desc: 'Browse every file & folder' },
  { to: 'audit', icon: '!', label: 'Audit for safety & junk', desc: 'Find leaks, clutter & risks' },
  { to: 'ask', icon: '?', label: 'Ask about a file', desc: 'Explain any file plainly' },
  { to: 'glossary', icon: '»', label: 'Learn the words', desc: 'Plain-English definitions' },
  { to: 'flow', icon: '↦', label: 'See how it fits together', desc: 'Map how the pieces connect' },
  { to: 'config', icon: '▣', label: 'Your setup', desc: 'See your settings & tidy the tree' },
];
```

Change the grid constants and the render's pairing loop to 3 across:

```js
// Launcher grid: 7 buttons in a 3×3 grid — trailing empty cells (row 3, cols 1-2)
// clamp instead of being reachable. 2D arrows move between buttons, Enter activates.
const COLS = 3;
const ROWS = Math.ceil(ITEMS.length / COLS);
```

Replace the `render` body after `const buttons = …` with a 3-way row helper:

```js
export function render(state, { root }) {
  const name = root.split('/').filter(Boolean).pop() || root;
  const btnW = Math.floor((boxWidth('full') - 8) / 3);
  const buttons = ITEMS.map((it, i) => buttonBox(it, idx(state.r, state.c) === i, btnW).split('\n'));
  const row3 = (a, b, c) => {
    const n = Math.max(a.length, b.length, c.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(`${a[i] ?? ' '.repeat(btnW)}  ${b[i] ?? ' '.repeat(btnW)}  ${c[i] ?? ' '.repeat(btnW)}`);
    }
    return out;
  };
  const header = `   ${g('★ ' + name.toUpperCase())}${state.celebrate ? `   ${g('★ You did it!')}` : ''}`;
  const rows = [header, ''];
  for (let i = 0; i < buttons.length; i += 3) {
    if (i > 0) rows.push('');
    rows.push(...row3(buttons[i], buttons[i + 1], buttons[i + 2]));
  }
  return box('appwalk', rows, { width: 'full' });
}
```

The existing `move()` function already generalizes to 3×3 (it scans columns/rows for the nearest `ok()` cell and wraps), so navigation needs no change. Remove the now-unused `side` helper.

- [ ] **Step 4: Update `src/tui/app.js`**

Add the screen + data-layer imports and the lazy builder:

```js
import { scanConfigFiles, suggestFiling } from '../config.js';
import * as config from './config.js';
```

Register the screen:

```js
export const SCREENS = { home, tour, viewer, tree, audit, glossary: glossaryScreen, try: tryScreen, flow, config };
```

Add the lazy builder next to `ensureFlow`:

```js
// The "Your setup" screen reads the config cards + filing suggestions. Built
// lazily on first entry and memoized so home never stalls (the ensureFlow pattern).
const ensureConfig = async (data) => {
  if (!data.config) data.config = { files: (await scanConfigFiles(data.map, data.stack)).files, filing: await suggestFiling(data.map) };
  return data.config;
};
```

And in the `onKey` handler, after the flow line at the bottom, add:

```js
if (screen.name === 'config') await ensureConfig(data);
```

(Place it right after the existing `if (screen.name === 'flow') await ensureFlow(...)` line.)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 140 pass, 0 fail (the 5 new home-test cases replace 2 old ones; total count may shift by the test split — verify 0 fail).

- [ ] **Step 6: Commit**

```bash
git add src/tui/home.js src/tui/app.js test/tui-home.test.js
git commit -m "$(cat <<'EOF'
feat: wire "Your setup" as the 7th home button in a 3×3 launcher grid

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Bump to 0.1.8, update status doc, full suite, release

**Files:**
- Modify: `package.json` (version)
- Modify: `CLAUDE.md` (Status: note the "Your setup" screen + test count)

**Interfaces:**
- Consumes: all prior tasks landed and green.

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.1.7"` → `"version": "0.1.8"`.

- [ ] **Step 2: Update the Status section of `CLAUDE.md`**

Under the existing flow-map paragraph, add:

> The **"Your setup" screen** (7th home button) shipped 2026-08-02: a Settings view that teaches each config file (what it controls · how yours is set · why · you could also…) and a Clean-it-up view with role-grouped filing suggestions grounded in this project, plus tips and a clutter pointer. `src/config.js` is pure static analysis (zero AI, never shows `.env` values, never moves files); `src/tui/config.js` renders it as a two-view screen. `npm test` = 140 tests.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all pass, 0 fail.

- [ ] **Step 4: Commit the bump**

```bash
git add package.json CLAUDE.md
git commit -m "$(cat <<'EOF'
chore: bump to 0.1.8 ("Your setup" — config assessment + clean filing)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Live drive the shell (no TTY)**

Run from `/home/ren/appwalk`:

```bash
cd /tmp && rm -rf appwalk-demo && mkdir appwalk-demo && cd appwalk-demo && \
  printf '{"main":"index.js","scripts":{"dev":"vite"},"type":"module"}' > package.json && \
  printf "import a from './a.js'; import b from './b.js'; import c from './c.js';" > index.js && \
  for f in a b c; do printf 'export default () => {};' > $f.js; done && \
  printf 'SECRET=hunter2\n' > .env && \
  printf 'node_modules\n.env\n' > .gitignore && \
  node /home/ren/appwalk/bin/appwalk.js
```

Then (in the running TUI, or by piping keys) verify: home shows 7 buttons, arrows reach "Your setup", Enter opens Settings with `package.json` first, `.env` is location-only, `2` switches to Clean it up showing the route-handler group + tips, `q` returns.

Piped-key smoke (no TTY) from the repo dir:

```bash
cd /tmp/appwalk-demo && printf 'down\ndown\nenter\n\n' | node /home/ren/appwalk/bin/appwalk.js 2>&1 | head -40
```

(Key order may need adjusting to how `mkLoop` reads lines; the goal is a human eye on the rendered boxes, not an assertion.)

- [ ] **Step 6: Publish**

Publish needs the npm token; the harness classifier blocks `npm publish`, so Kevin runs it:

```
! npm publish
```

Then verify:

```bash
npm view appwalk-cli version   # -> 0.1.8
```

---

## Self-Review

**Spec coverage:**
- Settings view (what/how/why/you-could-also) → Task 2 + Task 4 ✓
- `.env` location-only (with value-leak test) → Task 2 test + Task 4 test ✓
- Unknown + unparseable config → Task 2 (`generic` card, couldn't-parse card) ✓
- Clean-it-up role-grouped filing → Task 3 ✓
- Tips + clutter pointer → Task 3 (`tips`) + Task 4 (renderClean reads `data.findings`) ✓
- 7th home button + 3×3 grid → Task 5 ✓
- Lazy + memoized in the shell → Task 5 (`ensureConfig`) ✓
- Reuse flow's role heuristics → Task 1 (`classifyRole`) ✓
- Version 0.1.8 → Task 6 ✓

**Placeholder scan:** no TBD/TODO/"similar to Task N" — every step carries full code and commands.

**Type consistency:** `ConfigFile` (`path/name/kind/what/settings/note`), `Setting` (`key/value/why/alternatives`), `FilingGroup` (`role/label/files/suggestion/note`) are defined once in Task 2/Task 3 and consumed identically in Task 4. `suggestFiling` returns `{ groups, tips }`; the screen reads `cfg.filing.groups/tips` — consistent. `data.config = { files, filing }` built in Task 5 matches the screen's `data.config` reads.

**Known deviations from spec (intentional, within spec intent):**
- `suggestFiling` returns `{ groups, tips }` — the spec's `clutterRef` is delivered by the *screen* from the memoized `data.findings` (spec's intent: clutter pointer as extras) rather than computed inside the data layer, keeping the data layer cheap and decoupled from the heavy audit scan.
- `entry`/`config` roles are excluded from grouping suggestions (entry is one file; config at root is conventional and tooling depends on it) — better advice than moving `package.json`.
