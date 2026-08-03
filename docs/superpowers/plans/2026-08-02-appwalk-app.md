# appwalk desktop app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP desktop app — an Electron app that drives the free appwalk CLI (as a subprocess, JSON bridge) and presents an explore-first map + tour to non-developers. Plus package + sell it one-time.

**Architecture:** Two repos. (1) `~/appwalk` (public CLI) gains machine-readable JSON modes. (2) A **new closed repo** `~/appwalk-app` (private) holds the Electron app: sandboxed `main` spawns the CLI, a typed `preload` bridge feeds the warm-CRT `renderer` (plain HTML/CSS/JS). The app never imports the CLI's source — clean Fork B licensing.

**Tech Stack:** Node ≥20, Electron, plain HTML/CSS/JS renderer (warm-CRT tokens from the site), electron-builder for packaging, the storefront Stripe checkout for sales.

## Global Constraints

- **License boundary:** the app's code (Electron main/preload/renderer) is CLOSED — it must never `import` the CLI's source modules; it only spawns the CLI binary as a subprocess and reads JSON. The CLI (AGPL, public) stays the engine. This is non-negotiable.
- **Nothing leaves the machine** — no telemetry, no phone-home in the one-time edition, no AI key. The renderer is sandboxed (`contextIsolation`, `sandbox`, no `nodeIntegration`).
- **Warm-CRT identity** — reuse the site's tokens: `--bg:#0B0A09; --ink:#F2EBD9; --amber:#F2A93B; --amber-glow:rgba(242,169,59,.35); --mint:#7BCFA4; --ember:#E26D5C`, Space Mono (display) + Karla (body). Copy the token block + type rules from `~/storefront/public/appwalk.html`.
- The CLI's JSON modes are additive — the terminal output is unchanged.
- Zero-dep renderer (no React). Storefront tests stay green (96).
- Every commit ends with the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.

---

### Task 1: CLI JSON modes (`~/appwalk`)

**Files:**
- Modify: `bin/appwalk.js` (add `stack`, `flow` modes; `--json` branches to `tree`, `explain`, `glossary`)
- Create: `test/cli-json.test.js`

**Interfaces:**
- Produces (the app's contract — exact JSON shapes the renderer consumes):
  - `appwalk stack --json` → `{ "type": "node"|"python"|"static"|"unknown", "runCmd": string|null, "entry": string|null }`
  - `appwalk tree --json` → `{ "root": string, "hasEnv": bool, "files": [{ "name", "dir", "lang", "size", "entry" }] }`
  - `appwalk flow --json` → `{ "start": string|null, "nodes": [{ "path","name","rel","role","more" }], "edges": [{ "from","to" }], "order": string[] }` (the existing `buildFlow` result)
  - `appwalk explain <file> --json` → `{ "file": string, "text": string, "role"?: string }` (NO tokens/cost line)
  - `appwalk glossary --json` → `[{ "term","what","why","when","ask" }]`
  - `appwalk audit --json` already exists — leave as-is.

- [ ] **Step 1: Add a JSON helper** to `bin/appwalk.js`:

```js
const jsonOut = (data) => { console.log(JSON.stringify(data)); process.exit(0); };
```

- [ ] **Step 2: Add the `stack` mode** (before the `doctor` branch):

```js
} else if (mode === 'stack') {
  const { buildMap } = await import('./src/tree.js');
  const { detectStack } = await import('./src/walkthrough.js');
  const m = await buildMap(root);
  jsonOut(detectStack(m));
```

- [ ] **Step 3: Add `--json` to `tree`** (inside the existing `tree` branch, check `process.argv.includes('--json')` first):

```js
} else if (mode === 'tree') {
  const { buildMap } = await import('./src/tree.js');
  const m = await buildMap(root);
  if (process.argv.includes('--json')) jsonOut({ root: m.root, hasEnv: m.hasEnv, files: m.flat.map((n) => ({ name: n.name, dir: n.dir, lang: n.lang, size: n.size, entry: !!n.entry })) });
  // …existing terminal rendering unchanged below
```

- [ ] **Step 4: Add the `flow` mode**:

```js
} else if (mode === 'flow') {
  const { buildMap } = await import('./src/tree.js');
  const { detectStack } = await import('./src/walkthrough.js');
  const { buildFlow } = await import('./src/flow.js');
  const m = await buildMap(root);
  const s = detectStack(m);
  const f = await buildFlow(m, s, { depth: 3 });
  jsonOut(f);
```

- [ ] **Step 5: Add `--json` to `explain`** — capture the pure explanation before the token/cost line prints:

```js
} else if (mode === 'explain') {
  const file = process.argv[3]; if (!file) { console.log('usage: appwalk explain <file> (FAQ: usage)'); process.exit(0); }
  const r = await explain(root, file);
  if (process.argv.includes('--json')) jsonOut({ file, text: r.text, role: r.role });
  // …existing terminal print (r.text + token line) unchanged for non-json
```

- [ ] **Step 6: Add `--json` to `glossary`**:

```js
} else if (mode === 'glossary') {
  const q = process.argv[3];
  if (process.argv.includes('--json')) jsonOut(TERMS);
  if (!q) { console.log(TERMS.map((t) => t.term).join('\n')); }
  // …existing term print unchanged
```

- [ ] **Step 7: Write the JSON-contract tests** (`test/cli-json.test.js`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'appwalk.js');
const run = async (root, args) => JSON.parse((await exec('node', [BIN, ...args], { cwd: root })).stdout);

test('stack --json reports the app type + entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jstack-'));
  await writeFile(join(root, 'package.json'), '{"main":"index.js"}');
  await writeFile(join(root, 'index.js'), '// hi');
  const s = await run(root, ['stack', '--json']);
  assert.equal(s.type, 'node');
  assert.equal(s.entry, 'package.json');
});

test('tree --json lists files with roles + entry flags, never .env values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jtree-'));
  await writeFile(join(root, 'package.json'), '{}');
  await writeFile(join(root, 'index.js'), '// hi');
  await writeFile(join(root, '.env'), 'SECRET=hunter2');
  const t = await run(root, ['tree', '--json']);
  assert.ok(t.files.some((f) => f.name === 'index.js'));
  assert.ok(t.files.some((f) => f.entry), 'the entry file is flagged');
  assert.equal(t.hasEnv, true);
  assert.ok(!JSON.stringify(t).includes('hunter2'), '.env value never leaks');
});

test('flow --json returns nodes/edges/order with a resolved start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jflow-'));
  await writeFile(join(root, 'package.json'), '{"main":"index.js"}');
  await writeFile(join(root, 'index.js'), "import './a.js';");
  await writeFile(join(root, 'a.js'), 'export default 1;');
  const f = await run(root, ['flow', '--json']);
  assert.ok(Array.isArray(f.nodes) && Array.isArray(f.edges) && Array.isArray(f.order));
  assert.equal(f.start, join(root, 'index.js'));
});

test('glossary --json returns the full term list with ask prompts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jglos-'));
  const g = await run(root, ['glossary', '--json']);
  assert.ok(g.length >= 20);
  assert.ok(g.every((t) => t.term && t.what && t.ask));
});
```

- [ ] **Step 8: Run + commit**

Run: `node --test test/cli-json.test.js` → all pass; `npm test` → full suite green (145 + 4).
Commit in `~/appwalk` with the trailer.

---

### Task 2: Electron app scaffold (`~/appwalk-app`, NEW closed repo)

**Files:**
- Create: `package.json`, `electron/main.js`, `electron/preload.js`, `src/renderer/index.html`, `src/renderer/theme.css`, `src/renderer/app.js`, `.gitignore`
- Repo: create private `kevinpalencia46/appwalk-app` (via `gh repo create appwalk-app --private`), push.

**Interfaces:**
- Consumes: the CLI binary at `~/appwalk/bin/appwalk.js` (Task 1's JSON modes); the warm-CRT tokens from `~/storefront/public/appwalk.html`.
- Produces: a runnable Electron shell with the bridge — `window.appwalk.run(folder) → {stack, tree, flow}` and `window.appwalk.explain(file)`, `window.appwalk.audit(folder)`, `window.appwalk.glossary()`.

- [ ] **Step 1: Scaffold the repo**

```bash
mkdir -p ~/appwalk-app/electron ~/appwalk-app/src/renderer
cd ~/appwalk-app
npm init -y
npm install --save-dev electron electron-builder
```

`package.json` (edited):

```json
{
  "name": "appwalk-app",
  "version": "0.1.0",
  "main": "electron/main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder"
  },
  "devDependencies": { "electron": "^31", "electron-builder": "^24" },
  "build": {
    "appId": "ai.appwalk.app",
    "productName": "appwalk",
    "files": ["electron/**/*", "src/**/*"],
    "extraResources": [{ "from": "/home/ren/appwalk", "to": "appwalk-cli", "filter": ["bin", "src", "package.json"] }],
    "win": { "target": "nsis" },
    "linux": { "target": "AppImage", "category": "Education" }
  }
}
```

- [ ] **Step 2: `electron/main.js`** — sandboxed main: folder picker, spawn CLI, IPC:

```js
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The bundled CLI lives in resources (see extraResources). Dev fallback: ~/appwalk.
const CLI = join(process.resourcesPath, 'appwalk-cli', 'bin', 'appwalk.js');

const runCli = (cwd, args) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`appwalk ${args[0]} failed (${code})`)));
  p.on('error', reject);
});

const load = async (folder) => {
  const [stack, tree, flow, findings] = await Promise.all([
    runCli(folder, ['stack', '--json']), runCli(folder, ['tree', '--json']),
    runCli(folder, ['flow', '--json']), runCli(folder, ['audit', '--json']),
  ]);
  return { folder, stack, tree, flow, findings };
};

ipcMain.handle('appwalk:pick-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('appwalk:load', (e, folder) => load(folder));
ipcMain.handle('appwalk:explain', (e, { folder, file }) => runCli(folder, ['explain', file, '--json']));
ipcMain.handle('appwalk:glossary', () => runCli(process.cwd(), ['glossary', '--json']));

let win;
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1180, height: 820, backgroundColor: '#0B0A09',
    webPreferences: { preload: join(import.meta.dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadFile(join(import.meta.dirname, '..', 'src', 'renderer', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 3: `electron/preload.js`** — the typed bridge:

```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('appwalk', {
  pickFolder: () => ipcRenderer.invoke('appwalk:pick-folder'),
  load: (folder) => ipcRenderer.invoke('appwalk:load', folder),
  explain: (folder, file) => ipcRenderer.invoke('appwalk:explain', { folder, file }),
  glossary: () => ipcRenderer.invoke('appwalk:glossary'),
});
```

- [ ] **Step 4: Renderer shell** — `src/renderer/index.html` with the warm-CRT tokens (copy the `:root` block + Space Mono/Karla fonts from the site), a screen container, and `src/renderer/app.js` that calls the bridge. For this task, a minimal shell: title, a "Open a project" button that wires `window.appwalk.pickFolder()` → `load()` → renders the folder name + stack type. The full screens are Task 3.

- [ ] **Step 5: Smoke test**

```bash
cd ~/appwalk-app && npm start  # launches the app; verify the window opens and "Open a project" returns the folder + type
```

(If a display isn't available, run `xvfb-run -a npm start` or verify the main/preload logic with a unit test that stubs `ipcMain`/`BrowserWindow`.)

- [ ] **Step 6: Commit + create the private repo + push** (trailer; `gh repo create appwalk-app --private --source . --push`).

---

### Task 3: Renderer — the screens (`~/appwalk-app`)

**Files:**
- Modify: `src/renderer/index.html`, `theme.css`, `app.js` (build out the screens)
- The warm-CRT design system + type rules (from the site) define all styling.

**Interfaces:**
- Consumes: `window.appwalk.{pickFolder, load, explain, glossary}` (Task 2).
- Produces: the MVP screens.

- [ ] **Step 1: Open screen** — a centered "Open a project" (folder picker + drag-and-drop of a folder onto the window) + recent projects (stored in `localStorage`). On drop/pick → `appwalk.load(folder)`.

- [ ] **Step 2: Overview screen** — after load: project name (folder basename), the `stack.type` as a friendly line ("It's a Node.js app — Node is the program that runs JavaScript outside a browser" for `node`, matching the tour's language), the entry file (from `flow.start`), counts (files, findings), and two buttons: **Explore the map** / **Take the guided tour**.

- [ ] **Step 3: Map view** (primary) — render `flow` as a clickable SVG/div graph: a node per `order` entry, edges as connectors, the `start` node glowing amber. Click a node → the explain panel (right side): `appwalk.explain(folder, path)` → `text` + a "risky" badge if any `findings` reference the file. A left sidebar = the collapsible file tree from `tree.files` (green ● on `entry`), clicking a file opens the same explain panel. The glossary link on any highlighted term → glossary screen.

- [ ] **Step 4: Risks screen** — `findings` grouped by severity (secrets → ember, then clutter/deps/git), each showing `reason` + `fix` humanized.

- [ ] **Step 5: Tour mode** — a step-by-step guided walkthrough (one concept at a time) driven by the loaded data: "your app starts here" (entry) → "this folder does X" (first-level flow nodes) → "one risky thing" (a top finding) → glossary. Each step: a warm-CRT card with a Next button and a progress line. Reuses the tour's tone.

- [ ] **Step 6: Glossary screen** — `appwalk.glossary()` rendered as a searchable list; click a term → its what/why/when/ask.

- [ ] **Step 7: Settings/About** — version + edition ("you're on the current version — subscribers get every update" hint, static for now).

- [ ] **Step 8: Wire + verify** — every screen reachable; the app runs against `~/appwalk` (or any folder) end-to-end: Open → Overview → Map/explain → Risks → Tour → Glossary. Note any CLI JSON shape that doesn't match the renderer's expectation and fix the CLI or the renderer (the contract is Task 1's — the CLI wins).

- [ ] **Step 9: Commit + push** (trailer).

---

### Task 4: Package + sell the one-time

**Files:**
- Modify: `~/appwalk-app/package.json` (build config), the storefront (`catalog/products.json`, `server/*`, `public/appwalk.html`, `public/thanks.html`)
- Create: `~/appwalk-app/scripts/make-license.mjs` (offline license key generator)

**Interfaces:**
- Consumes: the built app (Task 3), the storefront checkout + Stripe (working).
- Produces: installers (Windows + Linux), an `appwalk-app` product, offline license keys.

- [ ] **Step 1: electron-builder installers**

```bash
cd ~/appwalk-app && npx electron-builder --win --linux
```

Verify `.exe` (NSIS) + `.AppImage` build; the CLI resources bundle; the app launches from the packaged build (AppImage under `xvfb` if headless). Commit the build artifacts' absence (gitignore `dist/`).

- [ ] **Step 2: Offline license key generator** (`scripts/make-license.mjs`):

```js
// One-time license: HMAC-signed "appwalk-app:<edition>:<version>"
import { createHmac } from 'node:crypto';
const SECRET = process.env.APPWALK_LICENSE_SECRET;   // a long random string, .env only
const edition = process.argv[2] || 'current';
const version = process.argv[3] || '0.1.0';
const payload = `appwalk-app:${edition}:${version}`;
const sig = createHmac('sha256', SECRET).update(payload).digest('base64url').slice(0, 24);
console.log(`${payload}:${sig}`);
```

- [ ] **Step 3: Storefront product** — add `appwalk-app` to `catalog/products.json` (fixed price, e.g. `price_cents: 4900` CAD, `status: 'live'`, `page_path: '/appwalk.html'`, `price_mode` absent). `POST /api/checkout` already works.

- [ ] **Step 4: The app's own download + license page** — a new storefront page (e.g. `public/download/appwalk.html` or extend `thanks.html` for this product): after checkout, the success redirect shows the installer links (Windows/Linux) + the license key for the one-time edition. For MVP, `thanks.html` gains a product-aware block: if the order is `appwalk-app`, show "Download appwalk for Windows / Linux" + a license key. The license key is generated server-side (the storefront's `stripe.js` webhook handler or a `/api/download` endpoint guarded by the live Stripe secret — never stored in the page).

- [ ] **Step 5: App-side license check (offline)** — the app's Settings shows the edition; entering a license key validates the HMAC locally (same `APPWALK_LICENSE_SECRET` embedded in the app is a weak move — for MVP, validate the signature format + payload; harden with a real key later). One-time: the app runs fully regardless; the key is the proof-of-purchase.

- [ ] **Step 6: Storefront tests + commit both repos** (trailer each).

---

### Task 5: Verification

**Files:** verify only.

- [ ] **Step 1: Contract check** — run every JSON mode against `~/appwalk` and a temp project; assert the shapes in Task 1's interface block match what the renderer consumes (fix drift; CLI wins).
- [ ] **Step 2: E2E** — packaged AppImage (headless `xvfb`) opens → Open a project → Map renders nodes/edges → click a node → explain panel → Risks → Tour → Glossary. Screenshot via CDP to eyeball layout (the headless-chrome technique).
- [ ] **Step 3: Storefront** — `npm test` green; the `appwalk-app` checkout creates a real session; the thanks page shows downloads + license.
- [ ] **Step 4: Live glance + report** — record the E2E result, installers built, and the one-time purchase flow. Push both repos.

---

## Self-Review

**Spec coverage:** CLI JSON bridge (Task 1) · Electron scaffold + sandboxed main/preload (Task 2) · all 8 screens incl. explore-first map + tour mode (Task 3) · packaging Win+Linux, storefront product, offline license (Task 4) · E2E verification (Task 5). Mac deferred + subscription licensing deferred per spec.

**Placeholder scan:** the renderer screens are specified by screen + data + design-system reference, not vague TODOs; the code-heavy pieces (CLI modes, main, preload, license generator) carry complete code.

**Type consistency:** the JSON shapes in Task 1's Interfaces block are the single contract; Task 2's `runCli` returns them, Task 3's renderer consumes them, Task 4's verify checks them. `window.appwalk.{pickFolder,load,explain,glossary}` defined once in preload and used in the renderer.

**Known deviations:** the `explain` JSON includes a `role` field best-effort from flow; the license check in the MVP is format-validation (a real offline-verification scheme is a follow-up); the app repo is created private (Fork B) — flag if Kevin wants it public.
