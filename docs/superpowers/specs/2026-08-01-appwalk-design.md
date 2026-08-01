# appwalk — walk your app, understand your code

**Date:** 2026-08-01 · **Status:** approved in design conversation (Kevin), spec for review

## What this is

A terminal CLI that guides a person through their own app, front to back, the way a
senior dev would on a walkthrough: *here's how it starts, here's your entry point,
here's what each folder does, here's the main flow, here's what's broken or risky,
and here's the word for what you're looking at.* Built for people who **vibe-code** —
they shipped an app with AI but don't understand the code underneath, are nervous it's
full of junk or leaked secrets, and want to learn + get peace of mind.

**Working name:** `appwalk`. **One-line pitch:** the guided tour and safety audit for
code you didn't write yourself.

## Why it's buildable and sellable

- The walkthrough itself is **rule-driven**, not AI-dependent: reading a tree, finding
  entry points, explaining known folder patterns. AI (user's own key) only *enriches* —
  so the core costs us nothing to run and works offline.
- The market is real: a growing wave of AI-shipped apps whose owners can't explain a
  single file. Existing tools (Cursor, Copilot, security scanners) assume the user can
  code; this one assumes they can't and walks them to competence. That's the gap.
- **Monetization:** users bring their own AI key → our inference cost ≈ zero. The tool
  itself carries the price: free tree + walkthrough, paid deep-audit + monitor + report.
- It dogfoods the audit methodology this project's author has been running by hand.

## Design pillars

1. **Deterministic core, AI enhancement.** The map, walkthrough, audit scans, glossary,
   and report all work with zero AI. The `ai` module is a pluggable, bring-your-own-key
   layer that answers "explain this file", "what does this error mean", and free-form
   questions. Providers: Anthropic API, DeepSeek, local Ollama, Claude Code CLI.
2. **Teach the language.** Every concept the tool touches (refactoring, auth, RLS,
   dependency, environment variable, endpoint, …) is one keystroke from a plain-language
   definition: *what it is + why it matters to you + when you'd use it.* Learning is a
   feature, not a side effect.
3. **History-aware explanations.** When explaining a file, look at git history:
   "added 3 weeks ago for X", "this function was changed to fix a bug on Jul 12". The
   difference between explaining *what* code is and *why it exists*.
4. **One command, no install friction.** `npx appwalk` (or `npm i -g appwalk`) in any
   project. Zero required dependencies. Works offline for the core.
5. **Everything is explainable in situ.** Audit findings don't just say "secret found" —
   they explain the risk and the fix, and link to the glossary term.

## Architecture

Node 20+, ESM, zero runtime deps (ANSI TUI written by hand, `node:test` for tests).
Modules, each one focused and independently testable:

```
bin/appwalk               # thin entry: parse args, dispatch mode
src/
  tree.js                 # build the project map
  tui.js                  # ANSI key-driven browser (tree pane + detail pane + input)
  walkthrough.js          # deterministic guided tour steps
  audit/
    secrets.js            # key patterns, .env-in-git, hardcoded creds
    clutter.js            # .bak/.tmp/unreferenced/empty dirs, "TODO forever"
    duplicates.js         # near-identical files → amalgamation candidates
    deps.js               # unused/outdated packages, missing lockfile
    githygiene.js         # uncommitted, oversized files, stray creds
  monitor.js              # run the app, tail logs, health check
  glossary.js             # term dictionary (code-driven, ~60 terms to start)
  history.js              # git-log-aware "why does this file exist" context
  ai/
    index.js              # provider router (anthropic | deepseek | ollama | claude-code)
    explain.js            # "explain this file / error / diff" via the user's key
  report.js               # markdown + HTML audit report
  util.js                 # esc, walk, lang-detect, size/units
test/                     # node:test suites, one per module
```

## Modes (CLI)

- `appwalk` — the guided tour (default). Interactive, deterministic steps, AI-enhanced.
- `appwalk tree` — the file map browser (the "game path" click-through).
- `appwalk audit` — run all audit scans, print findings + risks + fixes (each linked to glossary). `--json` for tooling.
- `appwalk audit --report` — also write `appwalk-report.html` (shareable).
- `appwalk monitor` — run the app, tail the log, hit the health route, flag errors.
- `appwalk explain <file> [line]` — one-shot "explain this" via the user's AI key.
- `appwalk glossary [term]` — list terms / show one.
- `appwalk doctor` — self-check (node version, git present, AI key valid if configured).

## The tree map (centerpiece)

A terminal file browser. Arrow keys move the cursor, Enter opens a file (detail pane),
`a` toggles audit markers, `g` shows glossary terms for the current file, `?` help.
Per-entry: language, size, last-modified, git status. **Duplicate markers** appear on
files the audit flags as near-identical → "these two overlap; candidates to merge."
The map respects `.gitignore` and always surfaces: entry points (package.json /
main.py / index.html / Dockerfile), config files, and the `.env` location (without
printing values).

## The walkthrough flow (deterministic)

1. **Detect stack** — package.json → `npm run dev`; main.py; index.html; Dockerfile; etc.
2. **"How it starts"** — open the entry point, explain what it does (rule-driven + AI).
3. **"These are your folders"** — one pass through the tree with per-folder purpose.
4. **"The main flow"** — follow one real request path through the code (e.g. a page load
   → handler → data → render), showing the files it touches.
5. **"What to watch"** — the audit findings a beginner should care about first.
Every term links to the glossary; every file explanation can include history context.

## Audit checks (v1)

- **Secrets:** real key prefixes (`sk_live_`, `sk-`, `AKIA`, `ghp_`, `AIza`, `xoxb-`,
  `postgres://`, `mongodb+srv://`, `-----BEGIN`, hardcoded passwords); `.env` committed
  to git; keys in code files. Each finding: what it is, why it's dangerous, the fix.
- **Clutter:** `.bak`/`.tmp`/`.orig`, unreferenced source files, empty directories,
  files that only contain TODO/FIXME (the "amalgamate or delete" list).
- **Duplicates:** near-identical files (content hash / similarity) → merge candidates.
- **Deps:** declared-but-unused packages (best-effort import scan), missing lockfile,
  notably outdated major versions.
- **Git hygiene:** uncommitted changes, oversized committed files, `.env` in the tree.

## Monitor

`appwalk monitor` detects the run command, spawns the app, tails stdout/stderr, watches
for crash signatures and stack traces, hits known health routes. On an error, offers the
AI (user's key) to explain it. Clean shutdown on Ctrl-C.

## Glossary (v1 ~60 terms)

auth · API key · RLS (row-level security) · environment variable · dependency ·
package.json · endpoint · route · middleware · database · migration · refactoring ·
debugging · deploy · CI/CD · linter · type · schema · ORM · webhook · … Each entry:
1-line definition, why it matters to *you*, when you'd use it. Terms surface inline in
every mode.

## History-aware explanations

`history.js` uses `git log --follow --format=...` + blame for a file: first commit date,
number of changes, last change reason (commit message). The AI layer can turn this into
a sentence: *"auth.ts was added 3 weeks ago and changed 14 times — most recently to fix
a login bug on Jul 12."* If no git, degrades gracefully (no history block).

## Error handling

- **Not a recognized project:** `appwalk` explains what it needs (git init? package
  manager? just files?) and still offers the tree mode.
- **AI key missing:** every AI-enriched feature degrades to the deterministic answer +
  "add your key in `.env` to get AI explanations" (never a hard failure).
- **Big repos:** tree/walkthrough cap file reads; audit streams and reports progress.
- **The `.env` is shown as a *location*, never its values** — in any mode.

## Testing

- `node:test` per module. tree (gitignore, nested, empty repos), audit scanners
  (fixtures with real key patterns / duplicate files / TODO files), walkthrough (stack
  detection for each supported type), glossary (every term renders), monitor (a fake
  app that crashes → detected), report (deterministic HTML).
- Per the verification pact: after shipping, run `appwalk` against a real project
  (this repo) and glance at the output.

## Build order (each is a shippable vertical slice)

1. `tree` + `tui` + `appwalk tree` (the file map — the hook).
2. `glossary` + `walkthrough` (the tour — works with no AI).
3. `audit/secrets` then `audit/duplicates` + `clutter` (the money features).
4. `history` + `ai/explain` (BYO key enrichment).
5. `monitor`, `report`, `doctor`.

## Out of scope (v1)

- No server / accounts / cloud billing (BYO key = no backend).
- No IDE extension, no GitHub app (CLI + report first; those are v2 paths).
- No writing code for the user — it explains and audits, it does not refactor for them
  (that's a later "suggest the fix" step, AI-gated).

## Monetization note

Freemium, one-time or subscription at launch: **free** = tree + walkthrough + glossary +
secrets scan. **Pro** = full audit (duplicates/deps/git), monitor, HTML report, AI
explanations beyond the free quota (if we ever meter it). Because users bring their own
key, marginal cost stays near zero and the tool can be priced as a plain product.
