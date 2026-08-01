# appwalk Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn appwalk into an app-like terminal UI — a framed home screen, interactive guided tour, expandable folder tree, file viewer with light syntax coloring, and a findings list — all zero-dependency ANSI, built on a reusable toolkit, with the existing data layer untouched.

**Architecture:** A `src/tui/` directory holds a reusable ANSI toolkit (`kit.js`) plus one module per screen (`home.js`, `tour.js`, `tree.js`, `viewer.js`, `audit.js`), each exporting a pure `render(state, data)` and `step(state, key, data)`. `app.js` owns the shell loop and the screen stack. `src/tui.js` (the flat-list browser) is replaced by the tree screen.

**Tech Stack:** Node 20+ ESM, zero runtime deps, hand-written ANSI, `node:test` + `assert/strict`.

## Global Constraints

- Node >= 20, ESM, **zero runtime dependencies**.
- Tests via `node --test` + `assert/strict` (`npm test`). 40 tests exist today and must stay green (the data layer is untouched; `test/tui.test.js` moves to the tree screen).
- The `.env` file is shown as a location only — **never render its values** (the viewer refuses to open it).
- Every screen's `render` and `step` are PURE (no I/O) and unit-tested; only `kit.js`'s `mkLoop` touches stdin/stdout (injectable).
- `appwalk` with no mode launches the shell. Explicit modes (`tree`, `audit --report`, `explain`, `glossary <term>`, `monitor`, `doctor`) still work as one-shot commands.
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `src/tui/kit.js` — the ANSI toolkit

**Files:**
- Create: `src/tui/kit.js`, `test/tui-kit.test.js`

**Interfaces:**
- Produces: `box(title, lines, {width}) -> string`; `bar(left, right) -> string`; color helpers `c(code,s)`, `g`, `b`, `y`, `r`, `dim`, `inv`; `decodeKey(buf) -> { token, used }`; `mkLoop({ stdin, stdout, onKey }) -> Promise`.

- [ ] **Step 1: Write the failing test**

```js
// test/tui-kit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { box, bar, g, dim, decodeKey } from '../src/tui/kit.js';

test('box draws a framed panel with a title', () => {
  const out = box('hello', ['one', 'two'], { width: 16 });
  assert.match(out, /┌─ hello/);
  assert.match(out, /│ one/);
  assert.match(out, /└────/);
});
test('colors wrap in ANSI codes', () => {
  assert.equal(g('ok'), '\x1b[32mok\x1b[0m');
  assert.equal(dim('x'), '\x1b[2mx\x1b[0m');
});
test('decodeKey handles arrows, enter, letters, split escapes, and CRLF', () => {
  assert.deepEqual(decodeKey('\x1b[A'), { token: 'up', used: 3 });
  assert.deepEqual(decodeKey('\x1b[B'), { token: 'down', used: 3 });
  assert.deepEqual(decodeKey('\x1b[C'), { token: 'right', used: 3 });
  assert.deepEqual(decodeKey('\x1b[D'), { token: 'left', used: 3 });
  assert.deepEqual(decodeKey('\r'), { token: 'enter', used: 1 });
  assert.deepEqual(decodeKey('\r\n'), { token: 'enter', used: 2 });
  assert.deepEqual(decodeKey('q'), { token: 'q', used: 1 });
  assert.deepEqual(decodeKey('\x1b'), { token: null, used: 1 });   // lone esc: consume, no token
});
test('bar renders an inverse-video status line', () => {
  const out = bar('tree', '↑↓ move · q quit');
  assert.ok(out.startsWith('\x1b[7m'));
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```js
// src/tui/kit.js
export const W = () => process.stdout.columns || 80;
export const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
export const g = (s) => c('32', s);
export const b = (s) => c('34', s);
export const y = (s) => c('33', s);
export const r = (s) => c('31', s);
export const dim = (s) => c('2', s);
export const inv = (s) => c('7', s);

export function box(title, lines, { width = W() } = {}) {
  const w = Math.min(Math.max(width, 30), 120);
  const inner = w - 4;
  const t = String(title);
  const top = `┌─ ${t} ${'─'.repeat(Math.max(0, w - t.length - 5))}┐`;
  const rows = lines.map((l) => `│ ${String(l).slice(0, inner).padEnd(inner)} │`);
  return [top, ...rows, `└${'─'.repeat(w - 2)}┘`].join('\n');
}

export function bar(left, right) {
  const w = W();
  const l = String(left), r2 = String(right);
  return inv((l + ' '.repeat(Math.max(1, w - l.length - r2.length)) + r2).slice(0, w));
}

export function decodeKey(buf) {
  if (buf[0] === '\x1b') {
    if (buf[1] === '[' && 'ABCD'.includes(buf[2])) {
      return { token: { A: 'up', B: 'down', C: 'right', D: 'left' }[buf[2]], used: 3 };
    }
    return { token: null, used: 1 };   // lone esc or unknown escape: consume one byte
  }
  if (buf[0] === '\r' || buf[0] === '\n') {
    return { token: 'enter', used: (buf[0] === '\r' && buf[1] === '\n') ? 2 : 1 };
  }
  return { token: buf[0], used: 1 };
}

export function mkLoop({ stdin, stdout, onKey }) {
  const wasRaw = stdin.isRaw;
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let buf = '';
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stdin.removeListener('data', onData);
      if (stdin.setRawMode && wasRaw === false) stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\x1b[2J\x1b[H');
      resolve();
    };
    const onData = (chunk) => {
      try {
        buf += chunk;
        while (buf.length) {
          // wait for a full escape sequence before decoding it
          if (buf[0] === '\x1b' && buf.length < 3) break;
          const d = decodeKey(buf);
          buf = buf.slice(d.used);
          if (d.token === null) continue;
          if (onKey(d.token) === false) return finish();
        }
      } catch (e) { finish(); }
    };
    stdin.on('data', onData);
  });
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` → kit tests pass.

- [ ] **Step 5: Commit** — `git add src/tui/kit.js test/tui-kit.test.js && git commit -m "tui: ANSI toolkit (box/bar/colors/decodeKey/mkLoop)"`

---

### Task 2: Home screen + the shell loop

**Files:**
- Create: `src/tui/home.js`, `test/tui-home.test.js`
- Create: `src/tui/app.js`
- Modify: `bin/appwalk.js` (default mode → launch the shell)

**Interfaces:**
- Consumes: `box`, `bar`, `g`, `b` from `./kit.js`.
- Produces: `home.init() -> { sel: 0 }`; `home.render(state, { root }) -> string`; `home.step(state, key) -> {…state} | { to } | { done }`; `app.shell(root) -> Promise` (launches the loop); `SCREENS` map in `app.js` (filled as later screens land; for now only `home`).

- [ ] **Step 1: Write the failing test**

```js
// test/tui-home.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/home.js';

test('home render shows the project name and 5 choices', () => {
  const s = render(init(), { root: '/home/ren/great-pacific' });
  assert.match(s, /appwalk/);
  assert.match(s, /great-pacific/);
  assert.match(s, /guided tour/);
  assert.match(s, /Explore your files/);
  assert.match(s, /Audit for safety/);
  assert.match(s, /Ask about a file/);
  assert.match(s, /Learn the words/);
});
test('home step: arrows move, enter routes, q quits', () => {
  let s = init();
  assert.equal(step(s, 'down').sel, 1);
  assert.equal(step({ sel: 4 }, 'down').sel, 4);            // clamps at last
  assert.deepEqual(step({ sel: 0 }, 'enter'), { to: 'tour' });
  assert.deepEqual(step({ sel: 1 }, 'enter'), { to: 'tree' });
  assert.deepEqual(step({ sel: 2 }, 'enter'), { to: 'audit' });
  assert.deepEqual(step({ sel: 3 }, 'enter'), { to: 'ask' });
  assert.deepEqual(step({ sel: 4 }, 'enter'), { to: 'glossary' });
  assert.deepEqual(step(init(), 'q'), { done: true });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```js
// src/tui/home.js
import { box, g, b } from './kit.js';

export const ITEMS = [
  { to: 'tour', icon: '🚶', label: 'Take the guided tour' },
  { to: 'tree', icon: '🗂', label: 'Explore your files' },
  { to: 'audit', icon: '🛡', label: 'Audit for safety & junk' },
  { to: 'ask', icon: '💬', label: 'Ask about a file' },
  { to: 'glossary', icon: '📖', label: 'Learn the words' },
];

export const init = () => ({ sel: 0 });
export const hints = 'arrows move · Enter choose · q quit';

export function render(state, { root }) {
  const name = root.split('/').filter(Boolean).pop() || root;
  const rows = [
    '   👋  Hi! I\'ll help you understand your app.',
    `      Looking at:  ${b(name)}`,
    '',
    ...ITEMS.map((it, i) => `   ${i === state.sel ? g('▶') : ' '}  ${it.icon}  ${it.label}`),
    '',
    `   (${g(hints)})`,
  ];
  return box('appwalk', rows);
}

export function step(state, key) {
  if (key === 'down') return { ...state, sel: Math.min(ITEMS.length - 1, state.sel + 1) };
  if (key === 'up') return { ...state, sel: Math.max(0, state.sel - 1) };
  if (key === 'enter') return { to: ITEMS[state.sel].to };
  if (key === 'q') return { done: true };
  return state;
}
```

```js
// src/tui/app.js — the shell. Screens are registered here as they land.
import { mkLoop, bar } from './kit.js';
import { buildMap } from '../tree.js';
import { detectStack } from '../walkthrough.js';
import * as home from './home.js';

export const SCREENS = { home };

export async function shell(root) {
  const map = await buildMap(root);
  const data = { root, map, stack: detectStack(map) };
  let screen = { name: 'home', state: home.init() };
  const paint = () => {
    const cur = SCREENS[screen.name];
    process.stdout.write('\x1b[2J\x1b[H' + cur.render(screen.state, data) + '\n' + bar(screen.name, cur.hints));
  };
  await mkLoop({
    stdin: process.stdin,
    stdout: process.stdout,
    onKey: (key) => {
      const cur = SCREENS[screen.name];
      const next = cur.step(screen.state, key, data);
      if (next?.done) return false;
      if (next?.to) {
        const target = SCREENS[next.to];
        if (!target) return true;              // screen not built yet — stay put
        screen = { name: next.to, state: next.params ? { ...target.init(), ...next.params } : target.init() };
      } else if (next) {
        screen = { name: screen.name, state: next };
      }
      paint();
      return true;
    },
  });
}
```

`bin/appwalk.js`: change the `walk`/default branch to launch the shell:
```js
import { shell } from '../src/tui/app.js';
// replace: if (mode === 'walk' || mode === 'help' || mode === '--help') { ... }
if (mode === 'walk' || mode === 'help' || mode === '--help') {
  if (mode === 'help' || mode === '--help') { console.log(HELP); process.exit(0); }
  await shell(root);
  process.exit(0);
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test` (home tests pass; existing 40 stay green). Manual smoke: `printf 'q' | node bin/appwalk.js` → renders the home frame, `q` exits cleanly.

- [ ] **Step 5: Commit** — `git add src/tui/home.js test/tui-home.test.js src/tui/app.js bin/appwalk.js && git commit -m "tui: home menu screen + shell loop (appwalk opens an app, not a dump)"`

---

### Task 3: Interactive guided-tour screen

**Files:**
- Create: `src/tui/tour.js`, `test/tui-tour.test.js`
- Modify: `src/tui/app.js` (register `tour` in `SCREENS`)

**Interfaces:**
- Consumes: `box`, `bar`, `g`, `b` from `./kit.js`; `buildTour(map, stack)` from `../walkthrough.js` (returns `Step[]` with `{title, body, files}`); `glossary.findMatches` + `lookup`.
- Produces: `tour.init() -> { step: 0 }`; `tour.render(state, data) -> string` (frames step N of total, body wrapped, progress in the header, hints in the bar); `tour.step(state, key, data) -> {…state} | { to, params } | { done }`.

- [ ] **Step 1: Write the failing test**

```js
// test/tui-tour.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { detectStack } from '../src/walkthrough.js';
import { init, render, step } from '../src/tui/tour.js';

async function makeData() {
  const root = await mkdtemp(join(tmpdir(), 'tour-ui-'));
  await writeFile(join(root, 'package.json'), '{"name":"x","scripts":{"dev":"node src/index.js"}}');
  await writeFile(join(root, 'index.js'), 'console.log("hi");');
  const map = await buildMap(root);
  return { root, map, stack: detectStack(map) };
}

test('tour render shows step N of total and a body', async () => {
  const data = await makeData();
  const s = render(init(), data);
  assert.match(s, /step 1 of/);
  assert.ok(s.length > 40);
});
test('tour step advances, opens a file, and finishes on the last step', async () => {
  const data = await makeData();
  const tour = await (await import('../src/walkthrough.js')).buildTour(data.map, data.stack);
  let s = init();
  assert.equal(step(s, 'enter', data, tour).step, 1);
  assert.deepEqual(step({ step: 0 }, 'o', data, tour), { to: 'viewer', params: { file: tour[0].files[0] } });
  assert.deepEqual(step({ step: tour.length - 1 }, 'enter', data, tour), { done: true });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Write the implementation**

```js
// src/tui/tour.js
import { box, bar, g, b, dim } from './kit.js';

export const init = () => ({ step: 0 });
export const hints = 'Enter continue · o open file · g glossary · q quit';

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

export function render(state, data, tour = data.tour) {
  const t = tour[state.step];
  if (!t) return box('Guided tour', ['(nothing to show)']);
  const total = tour.length;
  const header = `Guided tour · step ${state.step + 1} of ${total}`;
  const rows = [
    `  ${g('▶')}  ${b(t.title)}`,
    '',
    ...wrap(t.body, 56).map((l) => `  ${l}`),
    ...(t.files?.[0] ? ['', `  (file: ${dim(t.files[0].split('/').pop())} — press ${g('o')} to open)`] : []),
  ];
  return box(header, rows);
}

export function step(state, key, data, tour = data.tour) {
  if (key === 'enter') {
    if (state.step >= tour.length - 1) return { done: true };
    return { ...state, step: state.step + 1 };
  }
  if (key === 'o') {
    const f = tour[state.step]?.files?.[0];
    if (f) return { to: 'viewer', params: { file: f } };
    return state;
  }
  if (key === 'q') return { done: true };
  return state;
}
```

In `src/tui/app.js`, precompute the tour once (`data.tour = await buildTour(map, data.stack)`) and register `tour` in `SCREENS`. (Note: screens' `render`/`step` get `data`; `tour.js`'s functions accept an optional `tour` param so the pure tests pass it explicitly.)

- [ ] **Step 4: Run to verify it passes** — `npm test`; manual: `node bin/appwalk.js` → home → Enter on "guided tour" → step 1 renders; Enter advances to 6, then the "you did it" flow.

- [ ] **Step 5: Commit** — `git add src/tui/tour.js test/tui-tour.test.js src/tui/app.js && git commit -m "tui: interactive guided-tour screen"`

---

### Task 4: File viewer with light syntax coloring

**Files:**
- Create: `src/tui/highlight.js`, `test/tui-highlight.test.js`
- Create: `src/tui/viewer.js`, `test/tui-viewer.test.js`
- Modify: `src/tui/app.js` (register `viewer`)

**Interfaces:**
- Consumes: `box`, `bar`, `g`, `b`, `dim` from `./kit.js`; `readFileSafe` from `../util.js`.
- Produces: `highlight(code, lang) -> string` (ANSI, best-effort); `viewer.init(params) -> { file, line, mode }` (mode `'view'` or `'input'`); `viewer.render(state, data) -> string`; `viewer.step(state, key, data) -> {…state} | { to } | { done }`.

- [ ] **Step 1: Write the failing tests**

```js
// test/tui-highlight.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight } from '../src/tui/highlight.js';

test('highlight colors keywords blue, strings green, comments dim', () => {
  const out = highlight('const x = "hi"; // note', 'js');
  assert.match(out, /\x1b\[34mconst\x1b\[0m/);      // keyword blue
  assert.match(out, /\x1b\[32m"hi"\x1b\[0m/);        // string green
  assert.match(out, /\x1b\[2m\/\/ note\x1b\[0m/);    // comment dim
});
test('highlight passes unknown languages through unchanged', () => {
  const s = 'anything goes';
  assert.equal(highlight(s, 'txt'), s);
});
```

```js
// test/tui-viewer.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { init, render, step } from '../src/tui/viewer.js';

test('viewer renders the file header and refuses .env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-'));
  await writeFile(join(root, 'a.js'), 'const x = 1;');
  await writeFile(join(root, '.env'), 'SECRET=value');
  const map = await buildMap(root);
  const js = map.flat.find((n) => n.name === 'a.js');
  const s = render(init({ file: js.path, mode: 'view' }), { root, map });
  assert.match(s, /a\.js/);
  const env = init({ file: join(root, '.env'), mode: 'view' });
  assert.match(render(env, { root, map }), /location only/);
});
test('viewer step scrolls and backs out to home', () => {
  let s = init({ file: '/x/a.js', mode: 'view', line: 0 });
  s = step(s, 'down');
  assert.equal(s.line, 1);
  assert.deepEqual(step(s, 'enter'), { to: 'home' });
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL.

- [ ] **Step 3: Write the implementation**

```js
// src/tui/highlight.js
const KW = new Set(['const','let','var','function','return','import','from','export','default','if','else','for','while','class','new','async','await','true','false','null','undefined','type','interface','def','print']);
const OK = new Set(['js','ts','jsx','tsx','py','json','html','css']);

export function highlight(code, lang) {
  if (!OK.has(lang)) return code;
  let out = '';
  let i = 0;
  const s = String(code);
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1; while (j < s.length && s[j] !== ch) j++;
      if (s[j] === ch) j++;
      out += `\x1b[32m${s.slice(i, j)}\x1b[0m`; i = j; continue;
    }
    if ((ch === '/' && s[i + 1] === '/') || (lang === 'py' && ch === '#')) {
      let j = i; while (j < s.length && s[j] !== '\n') j++;
      out += `\x1b[2m${s.slice(i, j)}\x1b[0m`; i = j; continue;
    }
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));
    if (m && KW.has(m[0])) { out += `\x1b[34m${m[0]}\x1b[0m`; i += m[0].length; continue; }
    out += ch; i++;
  }
  return out;
}
```

```js
// src/tui/viewer.js
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { box, bar, g, b, dim } from './kit.js';
import { highlight } from './highlight.js';
const readFileSafeSync = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

export const init = (params = {}) => ({ file: params.file || null, line: 0, mode: params.mode || 'view', buf: '' });
export const hints = '↑↓ scroll · Enter back · g glossary · q quit';

export function render(state, data) {
  if (state.mode === 'input') {
    return box('Ask about a file', ['', '  Type a file path (relative or absolute):', '', `  ${g('▶')} ${state.buf}_`, '', '  (Enter to open · Esc to go back)']);
  }
  const file = state.file;
  if (!file) return box('File', ['  (nothing open)', '', '  Enter a path to view a file.']);
  if (file.endsWith('.env') || file.split('/').pop() === '.env') {
    return box(file.split('/').pop(), ['', '  This is your .env file.', '', '  appwalk shows it as a LOCATION only —', '  values are never printed.', '', '  (press Enter to go back)']);
  }
  const text = readFileSafeSync(file) ?? '';
  const lang = data.map?.flat?.find((n) => n.path === file)?.lang || 'txt';
  const lines = highlight(text, lang).split('\n');
  const page = lines.slice(state.line, state.line + 18);
  const rows = page.map((l, i) => `  ${String(state.line + i + 1).padStart(3)}  ${l}`);
  return box(file.split('/').pop() || file, rows, { width: Math.min(process.stdout.columns || 80, 100) });
}

export function step(state, key, data) {
  if (state.mode === 'input') {
    if (key === 'enter') {
      const p = state.buf.trim();
      const resolved = isAbsolute(p) ? p : join(data.root, p);
      return { file: resolved, line: 0, mode: 'view', buf: '' };
    }
    if (key === '\x7f' || key === 'backspace') return { ...state, buf: state.buf.slice(0, -1) };
    if (key === 'esc' || key === 'q') return { to: 'home' };
    if (/^[A-Za-z0-9_\-./~]$/.test(key)) return { ...state, buf: state.buf + key };
    return state;
  }
  if (key === 'down') return { ...state, line: state.line + 1 };
  if (key === 'up') return { ...state, line: Math.max(0, state.line - 1) };
  if (key === 'enter' || key === 'q') return { to: 'home' };
  return state;
}
```

Note: the viewer uses a synchronous file read for simplicity; `data.map.flat` gives the language. If `state.file` is a relative path, resolve against `data.root`.

- [ ] **Step 4: Run to verify it passes** — `npm test`; register `viewer` in `app.js` (`SCREENS.viewer = viewer`).

- [ ] **Step 5: Commit** — `git add src/tui/highlight.js test/tui-highlight.test.js src/tui/viewer.js test/tui-viewer.test.js src/tui/app.js && git commit -m "tui: file viewer with light syntax coloring + .env location guard"`

---

### Task 5: Expandable folder-tree screen (replaces `src/tui.js`)

**Files:**
- Create: `src/tui/tree.js`, `test/tui-tree.test.js`
- Delete: `src/tui.js`, `test/tui.test.js`
- Modify: `src/tui/app.js` (register `tree`); `src/tree.js` (already has `hasEnv`)

**Interfaces:**
- Consumes: `box`, `bar`, `g`, `b`, `dim` from `./kit.js`; `buildMap` from `../tree.js`; `scanDuplicates` from `../audit/duplicates.js`.
- Produces: `buildFolderTree(flat) -> Node[]` (pure; `Node = { name, path, dir, type: 'dir'|'file', children, lang, size, entry, dup }`); `tree.init() -> { cursor: 0, expanded: Set, showAudit: false }`; `tree.render(state, data) -> string`; `tree.step(state, key, data) -> {…state} | { to, params } | { done }`.

- [ ] **Step 1: Write the failing test**

```js
// test/tui-tree.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { buildFolderTree, init, render, step } from '../src/tui/tree.js';

test('buildFolderTree nests folders and files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ftree-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'x');
  await writeFile(join(root, 'package.json'), '{}');
  const map = await buildMap(root);
  const tree = buildFolderTree(map.flat);
  const top = tree.map((n) => n.name).sort();
  assert.deepEqual(top, ['package.json', 'src']);
  const src = tree.find((n) => n.name === 'src');
  assert.ok(src.type === 'dir' && src.children.length === 1);
});
test('tree render shows folders, entry points, and the .env location row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tview-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'import express from "express";');
  await writeFile(join(root, 'package.json'), '{"name":"x"}');
  const map = await buildMap(root);
  const s = render(init(), { root, map });
  assert.match(s, /src/);
  assert.match(s, /index\.js/);
});
test('tree step: enter opens a file, right expands a folder, q quits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tstep-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'x');
  const map = await buildMap(root);
  const tree = buildFolderTree(map.flat);
  let s = init();
  s = { ...s, tree };              // step needs the tree
  const opened = step(s, 'enter', { root, map, tree });
  if (opened.to) assert.equal(opened.to, 'viewer');
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Write the implementation**

```js
// src/tui/tree.js
import { box, bar, g, b, dim } from './kit.js';

export function buildFolderTree(flat) {
  const root = [];
  const dirs = new Map();          // path -> dir node
  const mkDir = (parts) => {
    let cur = root;
    let acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      let node = cur.find((n) => n.name === p && n.type === 'dir');
      if (!node) { node = { name: p, path: acc, type: 'dir', children: [] }; cur.push(node); }
      cur = node.children;
    }
  };
  for (const f of flat) {
    const parts = (f.dir || '').split('/').filter(Boolean);
    if (parts.length) { mkDir(parts); }
    const parent = parts.length
      ? (() => { let cur = root; let acc = ''; for (const p of parts) { acc = acc ? acc + '/' + p : p; cur = cur.find((n) => n.type === 'dir' && n.name === p).children; } return cur; })()
      : root;
    parent.push({ name: f.name, path: f.path, type: 'file', dir: f.dir, lang: f.lang, size: f.size, entry: f.entry });
  }
  return root;
}

export const init = () => ({ cursor: 0, expanded: new Set(), showAudit: false });
export const hints = '↑↓ move · ←/→ collapse · Enter open · a audit · q quit';

function flatten(tree, expanded, depth = 0) {
  const out = [];
  for (const n of tree) {
    if (n.type === 'dir') {
      out.push({ ...n, depth, open: expanded.has(n.path) });
      if (expanded.has(n.path)) out.push(...flatten(n.children, expanded, depth + 1));
    } else out.push({ ...n, depth });
  }
  return out;
}

export function render(state, data) {
  const tree = data.tree ?? buildFolderTree(data.map.flat);
  const rows = flatten(tree, state.expanded).map((n, i) => {
    const pad = '  '.repeat(n.depth);
    if (n.type === 'dir') {
      return `  ${pad}${state.expanded.has(n.path) ? '▾' : '▸'} ${b(n.name)}/   (${n.children.length} item${n.children.length === 1 ? '' : 's'})`;
    }
    const mark = n.entry ? g('●') : ' ';
    const meta = `${n.lang} · ${fmt(n.size)}`;
    return `  ${pad}${mark} ${n.name.padEnd(18)}${dim(meta)}${state.cursor === i ? '' : ''}`;
  });
  const hasEnv = data.map.hasEnv;
  return box(data.root.split('/').filter(Boolean).pop() || 'app', [...rows, ...(hasEnv ? ['', '  ▸ .env — location only'] : [])]);
}
const fmt = (n) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

export function step(state, key, data) {
  const tree = data.tree ?? buildFolderTree(data.map.flat);
  const rows = flatten(tree, state.expanded);
  const n = rows[state.cursor];
  if (key === 'down') return { ...state, cursor: Math.min(rows.length - 1, state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'right' && n?.type === 'dir') { const e = new Set(state.expanded); e.add(n.path); return { ...state, expanded: e }; }
  if (key === 'left' && n?.type === 'dir') { const e = new Set(state.expanded); e.delete(n.path); return { ...state, expanded: e }; }
  if (key === 'enter' && n?.type === 'file') return { to: 'viewer', params: { file: n.path, mode: 'view' } };
  if (key === 'a') return { ...state, showAudit: !state.showAudit };
  if (key === 'q') return { done: true };
  return state;
}
```

`app.js`: `SCREENS.tree = tree`, and compute `data.tree = buildFolderTree(data.map.flat)` once. Delete `src/tui.js` and `test/tui.test.js` (their `renderTree`/`step` tests are superseded; `runTree` is replaced by the shell). Move the `.env`-footer behavior into the tree render (uses `data.map.hasEnv`).

- [ ] **Step 4: Run to verify it passes** — `npm test` (all existing + new pass; the old `tui.test.js` is gone). Manual: home → "Explore your files" → the folder tree; `→` expands a folder; Enter opens a file.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "tui: expandable folder-tree screen (replaces the flat list)"`

---

### Task 6: Audit findings screen + glossary list screen

**Files:**
- Create: `src/tui/audit.js`, `test/tui-audit.test.js`
- Create: `src/tui/glossary.js`, `test/tui-glossary.test.js`
- Modify: `src/tui/app.js` (register `audit` and `glossary`)

**Interfaces:**
- Consumes: `box`, `bar`, `g`, `b`, `y`, `r`, `dim` from `./kit.js`; `allFindings(root, map)` aggregation; `glossary.TERMS`/`renderTerm`.
- Produces: `audit.init() -> { cursor: 0, detail: null }`; `audit.render(state, data) -> string`; `audit.step(state, key, data) -> {…state} | { done }`; `glossaryScreen.init(params) -> { cursor: 0, term: null }`; `glossaryScreen.render/step`.

- [ ] **Step 1: Write the failing tests**

```js
// test/tui-audit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, render, step } from '../src/tui/audit.js';

test('audit render lists findings and Enter opens a detail', () => {
  const data = { findings: [{ file: 'a.js', line: 3, kind: 'stripe_live', snippet: 'sk_l…cdef', label: 'Stripe live secret key' }] };
  const s = render(init(), data);
  assert.match(s, /stripe live secret key/i);
  let st = init();
  st = step(st, 'enter', data);
  assert.ok(st.detail);
  assert.match(render(st, data), /stripe live secret key/i);
});
```

```js
// test/tui-glossary.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/glossary.js';
import { TERMS } from '../src/glossary.js';

test('glossary screen lists terms and Enter shows one', () => {
  const s = render(init(), {});
  assert.match(s, /refactoring|auth|RLS|dependency/);
  let st = init();
  st = step(st, 'enter', {});
  assert.ok(st.term);
  assert.ok(render(st, {}).length > 40);
  assert.equal(TERMS.length >= 20, true);
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL.

- [ ] **Step 3: Write the implementation**

```js
// src/tui/audit.js
import { box, bar, g, b, y, r, dim } from './kit.js';

export const init = () => ({ cursor: 0, detail: null });
export const hints = '↑↓ move · Enter detail · q quit';

const color = (f) => f.kind === 'stripe_live' || f.kind === 'private_key' || f.kind === 'db_url' ? r : f.kind === 'duplicate' ? y : dim;

export function render(state, data) {
  const finds = data.findings || [];
  if (state.detail !== null) {
    const f = finds[state.detail];
    const lines = f ? [
      `  ${b(f.kind)}  ${f.file}${f.line ? ':' + f.line : ''}`,
      '',
      `  ${f.label || f.reason || ''}`,
      ...(f.snippet ? [`  snippet: ${g(f.snippet)}`] : []),
      ...(f.other ? [`  duplicate of: ${f.other} (sim ${f.sim})`] : []),
      '',
      '  (Enter to go back)',
    ] : ['  (no finding)'];
    return box('Finding', lines);
  }
  const rows = finds.map((f, i) => `  ${color(f)(f.kind === 'duplicate' ? '≡' : '⚠')}  ${f.file}${f.line ? ':' + f.line : ''}  ${(f.label || f.reason || f.kind).slice(0, 40)}`);
  return box(`audit — ${finds.length} finding${finds.length === 1 ? '' : 's'}`, rows.length ? rows : ['', '  No findings — clean 🎉', '']);
}

export function step(state, key) {
  if (key === 'down') return { ...state, cursor: Math.min((state.detail !== null ? 0 : 999), state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'enter') {
    if (state.detail !== null) return { ...state, detail: null };
    return { ...state, detail: state.cursor };
  }
  if (key === 'q') return { done: true };
  return state;
}
```

```js
// src/tui/glossary.js
import { box, bar, b, dim } from './kit.js';
import { TERMS, renderTerm } from '../glossary.js';

export const init = () => ({ cursor: 0, term: null });
export const hints = '↑↓ move · Enter show · q quit';

export function render(state) {
  if (state.term !== null) {
    const t = TERMS[state.term];
    return box('Glossary', ['', ...String(renderTerm(t)).split('\n').map((l) => `  ${l}`), '', '  (Enter to go back)']);
  }
  const rows = TERMS.map((t, i) => `  ${b(t.term)}${dim(' — ' + t.what.slice(0, 34))}`);
  return box(`Glossary — ${TERMS.length} terms`, rows);
}

export function step(state, key) {
  if (key === 'down') return { ...state, cursor: Math.min(TERMS.length - 1, state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'enter') { if (state.term !== null) return { ...state, term: null }; return { ...state, term: state.cursor }; }
  if (key === 'q') return { done: true };
  return state;
}
```

`app.js`: register `audit` and `glossary`; compute `data.findings = await allFindings(root, map)` before launching the shell (or lazily when the audit screen opens). Wire the home "ask" item → viewer in input mode, "glossary" → the glossary screen, "audit" → audit screen, "tour" → tour, "tree" → tree.

- [ ] **Step 4: Run to verify it passes** — `npm test`; manual: home → each menu item works end-to-end; audit Enter shows a detail; glossary Enter shows a term.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "tui: audit findings + glossary screens, full home routing"`

---

### Task 7: Full-shell wiring, cleanup, and end-to-end verification

**Files:**
- Modify: `src/tui/app.js` (final wiring: precompute `tour`/`tree`/`findings`; input-mode resolution for "ask"; clean exit)
- Modify: `CLAUDE.md` (Status: shell shipped)
- Delete: any leftover references to the old `src/tui.js`

- [ ] **Step 1: Final `app.js` wiring**

Precompute once: `data.tour = await buildTour(map, data.stack)`; `data.tree = buildFolderTree(map.flat)`; `data.findings = await allFindings(root, map)`. The viewer's input mode resolves `state.buf` against `data.root` (if not absolute). Verify every home item routes: tour / tree / audit / ask→viewer(input) / glossary.

- [ ] **Step 2: Run the whole suite**

Run: `npm test` — every test passes (kit/home/tour/highlight/viewer/tree/audit/glossary + the 40 data-layer tests). Count the total.

- [ ] **Step 3: The verification-pact glance — walk the whole shell**

Run: `cd ~/ren && node ~/appwalk/bin/appwalk.js` and drive it non-interactively as far as possible (`printf 'q' | node bin/appwalk.js` renders home; arrow/enter can't be scripted without a TTY, so verify each screen's render via a node one-liner: import each screen, call render(init(), data) with real ren data, and confirm no throw). Fix any screen that throws on real data (e.g. a file whose lang isn't in the highlighter, a finding with no label).

- [ ] **Step 4: Update `CLAUDE.md` Status**

Change Status to: "All modes + the appwalk shell (home menu, interactive tour, folder tree, file viewer with syntax coloring, audit + glossary screens) shipped 2026-08-01. Run `appwalk` (no mode) for the shell; explicit modes still work for scripting. `npm test` = N tests."
Commit: `git add -A && git commit -m "docs: status — appwalk shell shipped"`
