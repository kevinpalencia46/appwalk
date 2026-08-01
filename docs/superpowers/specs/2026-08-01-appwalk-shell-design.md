# appwalk shell — an app-like terminal UI for beginners

**Date:** 2026-08-01 · **Status:** approved in design conversation (Kevin), spec for the build

## Goal

Turn `appwalk` from a set of terminal commands into a **cohesive, app-like terminal experience** that a person new to coding feels confident navigating. Built for Termius (full ANSI), zero dependencies, and built entirely on top of the existing data layer.

## Principles

1. **It should feel like opening an app, not running a script.** A framed home screen greets you; every screen has a header bar, a body, and a status bar; there's one consistent visual language.
2. **Confidence through structure.** Big choices, clear hints ("↑↓ move · Enter choose · q quit"), progress ("step 2 of 6"), and encouragement — never a blank prompt or a wall of text.
3. **Every term is one keystroke from a plain explanation.** `g` anywhere opens the glossary for the word under the cursor.
4. **Zero dependencies.** The whole TUI is hand-written ANSI (the house style). All render functions are pure and unit-tested; the key handling is a pure `step(state, key)` state machine per screen (the pattern already used in `tree`).
5. **The data layer is untouched.** `buildMap`, `buildTour`, `detectStack`, `scanSecrets`/`scanDuplicates`/`scanClutter`/`scanDeps`/`scanGit`, `glossary`, `explain` — all unchanged. This spec is purely presentation.

## Architecture

New directory `src/tui/` (the reusable toolkit) plus one module per screen. The current `src/tui.js` (flat list + `step`) is superseded — its `renderTree`/`runTree` move into the tree screen, and its `step()` generalizes into the toolkit's key loop.

```
src/
  tui/
    kit.js        # ANSI toolkit: box/bar/color/center/pad; key decoder
    home.js       # the menu screen (render + step)
    tour.js       # interactive guided-tour screen (render + step)
    tree.js       # expandable folder-tree screen (render + step)  [replaces src/tui.js]
    viewer.js     # file detail pane with light syntax coloring (render + step)
    audit.js      # findings list screen (render + step)
    app.js        # the shell: owns the screen stack, the raw-mode loop, and the
                  #   per-screen key dispatch (uses each screen's step())
  ai/…, audit/…, tree.js…  # UNCHANGED data layer
test/
  tui-kit.test.js
  tui-home.test.js
  tui-tour.test.js
  tui-tree.test.js
  tui-viewer.test.js
  tui-audit.test.js
```

### The toolkit (`kit.js`)

- `box(title, lines, { width }) -> string` — a framed panel with a header row (`┌─ title ─┐ … └────┘`), lines wrapped/padded to `width`.
- `bar(left, right) -> string` — the bottom status bar: mode on the left, key hints on the right, inverse-video.
- Color helpers: `g(s)` green, `b(s)` blue, `y(s)` yellow, `r(s)` red, `dim(s)`; `c(s, code)` raw ANSI. Palette is fixed and small: green = safe/entry, blue = info, yellow = watch, red = danger.
- `decodeKey(buf) -> token` — the escape-sequence decoder (arrows, Enter, and letters), generalized from `tree`'s decoder and fixed for split sequences + `\r\n`.
- `mkLoop({ stdin, stdout, onKey }) -> { start, stop }` — the raw-mode key loop, reused by every screen. Guarantees `isRaw` restore on quit and on error. `stdin`/`stdout` injectable for tests.

### Screen contract

Every screen exports `render(state, { map, …data }) -> string` (pure) and `step(state, key, { …data }) -> newState | { screen: 'other', params } | { done: true }` (pure). The shell's loop calls `render`, prints it, then on a key calls the current screen's `step`; if the step returns a screen-change or `done`, the shell routes accordingly. This keeps every screen testable without a TTY (render + step are pure) — the `mkLoop` is the only I/O.

### Screen 1: Home (the menu)

```
┌─ appwalk ─────────────────────────────────────────────┐
│                                                       │
│   👋  Hi! I'll help you understand your app.           │
│      Looking at:  <project root name>                  │
│                                                       │
│   1  🚶  Take the guided tour                          │
│   2  🗂  Explore your files                            │
│   3  🛡  Audit for safety & junk                       │
│   4  💬  Ask about a file                              │
│   5  📖  Learn the words                               │
│                                                       │
│   (arrows to move · Enter to choose · q to quit)      │
└───────────────────────────────────────────────────────┘
```
- Shows the project name from `map.root`.
- Arrows move the selection; Enter routes to the chosen screen; `q` quits.
- Menu item 4 ("Ask about a file") routes to the viewer with a "type a file path" mini-prompt (simple input line); item 5 routes to the glossary list screen (a framed scrollable list of terms; Enter shows the entry).

### Screen 2: Tour (interactive)

The guided tour, one framed step at a time:
```
┌─ Guided tour · step 2 of 6 ───────────────────────────┐
│   ▶  How your app starts                              │
│                                                       │
│   <body text, wrapped>                                │
│                                                       │
│   (history: added 2026-07-12, changed 2 times)        │
│                                                       │
│   [Enter] continue   [o] open the file   [g] glossary │
└───────────────────────────────────────────────────────┘
```
- `Enter` advances; at the last step it returns to home with a "you did it 🎉" screen.
- `o` opens the step's first file (if any) in the viewer, returning to the tour on back.
- `g` opens the glossary for the first glossed term in this step's body.
- Progress is always visible.

### Screen 3: Tree (expandable folder tree)

Replaces the flat list with a Finder-style tree:
```
┌─ great-pacific-plumbing — your files ─────────────────┐
│  ▶ src/                          (folder, 6 files)   │
│    ▾ components/                  (folder, 4 files)   │
│      ▶ Header.js                  (js · 2.1 KB)       │
│      ● Hero.js                    (js · 3.4 KB)       │
│    ● index.js                     (js · entry)        │
│  ● package.json                   (json · entry)      │
│  ▸ .env — location only                              │
└───────────────────────────────────────────────────────┘
  ↑↓ move · ←/→ collapse · Enter open · a audit · g glossary · q quit
```
- Folders are expandable/collapsible (`←`/`→` or Enter on a folder).
- Entry points green with `●`; the `.env` row shows "location only", never values.
- Duplicate/audit markers still shown (from the existing scanners) when `a` is toggled.
- Enter opens a file in the viewer.

### Screen 4: Viewer (file detail)

```
┌─ src/components/Hero.js ──────────────────────────────┐
│  import { useState } from 'react'     (line 1)        │
│  export default function Hero() {                     │
│    // the hero section                                │
│  }                                                    │
└───────────────────────────────────────────────────────┘
  ↑↓ scroll · Enter back · g glossary · q quit
```
- Framed, filename header, line numbers, **light syntax coloring by language** (a tiny tokenizer: comments, strings, keywords for js/ts/py/html/css/json — best-effort, never crashes).
- Scrolling for long files; shows the `.env` guard if the file is `.env` (refuse to render values).

### Screen 5: Audit (findings list)

```
┌─ audit — 6 findings ──────────────────────────────────┐
│  ⚠ src/config.js:3  Stripe live secret key (sk_l…cdef)│
│  ⚠ .env  location only — shown, never opened          │
│  ≡ src/a.js  ~duplicate of src/b.js (sim 0.95)        │
│  · old.bak  leftover backup file                      │
└───────────────────────────────────────────────────────┘
  ↑↓ move · Enter details · r refresh · q quit
```
- Color-coded by kind (secrets red, duplicates yellow, clutter dim).
- Enter opens a detail panel: the explanation + a suggested fix + the glossary link.
- Reuses the existing scanners' findings; nothing new in the data layer.

### The shell (`app.js`) and CLI wiring

- `bin/appwalk.js`: running `appwalk` with no mode now launches the **shell** (home screen). Explicit modes (`tree`, `audit --report`, `explain`, `glossary <term>`, `monitor`, `doctor`) still work as one-shot commands for scripting. `appwalk tree` could optionally enter the tree screen directly.
- The shell owns the screen stack (`home → tour/tree/viewer/audit → …`) and the `mkLoop`; it restores the terminal cleanly on quit and on error (the hard rule from the current `runTree`).

## Error handling

- A screen's `render`/`step` never throws on bad data (empty map, no entry points, non-git). The shell catches anything and shows a friendly error frame, then returns to home.
- Terminal width is probed (`process.stdout.columns`) with a safe fallback (80) and a minimum-width hint for very narrow terminals.
- `.env` never renders values — the viewer refuses to open it and the tree shows it as "location only".

## Testing

- `kit.js`: box/bar/color render correctly; `decodeKey` handles split escape sequences + `\r\n`; `mkLoop` restores raw mode on quit and on error (mock stdio).
- Each screen: `render(state, …)` produces the expected frame for representative states (selected item, step 2 of 6, a collapsed/expanded folder, a finding); `step(state, key, …)` transitions correctly (menu choice → screen change; tour Enter → next step / last → done; tree ←/→ collapse; viewer Enter → back; audit Enter → detail).
- The existing 40 tests must stay green (the data layer is untouched; `src/tui.js`'s tests move to the tree screen).
- Per the verification pact: after shipping, run `appwalk` in a real project and walk the whole shell (home → tour → tree → viewer → audit → home).

## Build order (each is a shippable slice)

1. `kit.js` + its tests (the toolkit every screen needs).
2. `home` screen + the shell loop (`app.js`) — `appwalk` now opens a menu.
3. `tour` interactive screen.
4. `viewer` + `tree` (the expandable tree replaces the flat list).
5. `audit` screen + glossary list screen.
6. Full-shell verification + wiring cleanup.

## Out of scope (v1)

- No mouse support, no live-resize, no unicode-variable-width tuning (CJK in tree rows is best-effort).
- No web UI.
- No new audit/data features — this is the presentation shell only.
