# appwalk — "Your setup": config assessment + grounded clean-filing

**Date:** 2026-08-02 · **Status:** approved in design conversation (Kevin), spec for the build

## Goal

A 7th home screen — **"Your setup"** — that does two things, teaching-first:

1. **Settings** — for each config file in *this* project (package.json, `.env`, tsconfig, vite.config, Dockerfile, .gitignore, …), explain in plain language: **what it controls · how yours is actually set (real settings pulled from the file) · why · you could also…**. Built so a person stops guessing what their project's knobs mean.
2. **Clean it up** — project-grounded filing advice: classify every file **by role** (handler / data / render / util / config) and point out real groupings — *"these 4 files are all route handlers scattered at root — a `routes/` folder would group them"* — plus a short best-practice tips line and a pointer to the existing clutter audit findings as extras.

Deterministic core, zero AI, zero runtime deps, glossary-linked (the house rules). The tool **never** writes or moves a file — advice only.

## Principles

1. **Teach the language.** Every concept (dependency, environment variable, strict mode, container, lint) links to an existing glossary term. New terms get glossary entries, not inline walls.
2. **Grounded in the real project.** Settings are pulled from the actual files (a package.json with `"type": "module"` *says* that); filing suggestions come from the actual role groups in *this* tree — not generic advice.
3. **`.env` is a location, never its values.** The `.env` card shows where it is and what it protects. No value text ever renders — not in the config screen, not in an AI call.
4. **Read-only.** Nothing is ever written or moved. Filing advice is suggestions.
5. **Never crash on weird input.** Unknown config files get a generic card; unparseable config gets a "couldn't parse — here's why" card (the `deps.js` pattern).
6. **Pure render/step, lazy + memoized.** Same screen contract as flow/glossary; config data builds lazily and memoizes per project so the home menu never stalls.
7. **Reuse, don't fork.** Role classification reuses flow's heuristics via a new `classifyRole` export; `isConfigName` is already shared.

## Architecture

```
src/
  config.js       # NEW data layer (pure, zero-dep)
    scanConfigFiles(map, stack) -> { files: ConfigFile[] }
    suggestFiling(map)          -> { groups: FilingGroup[], tips: string[], clutterRef }
  flow.js         # export classifyRole(name, path, text) for reuse (extract from buildFlow's logic)
  tui/config.js   # NEW screen (pure render/step) — two views
  tui/home.js     # 7th button -> 'config'; grid becomes 3×3
  tui/app.js      # 'config' route; lazy memoized build (flowCache-style)
test/
  config.test.js      # data layer
  tui-config.test.js  # screen (render/step)
  tui-home.test.js    # updated for the 3×3 grid
```

### Data layer — `src/config.js`

#### `scanConfigFiles(map, stack) -> { files: ConfigFile[] }`

- Iterate `map.flat`, keep files matching flow's `isConfigName` regex (already the source of truth for "what's a config file").
- Match each against a `CONFIG_TYPES` knowledge base (keyed by name/regex). **All prose is original, written for this project — never copied from docs.**
- Known cards (bounded set, ordered package.json first):
  - `package.json` — pull actual fields: `scripts` ("here's how you run it"), `dependencies` vs `devDependencies` (why the split), `type: "module"` (ESM vs CommonJS — links to the `.js` = JavaScript lesson), `main`, `engines`. Alternatives: yarn/pnpm, `private: true` before publishing, lockfile presence (`package-lock.json`).
  - `.env` — location-only card: "your secrets live here; appwalk never shows them; make sure it's in `.gitignore`." **No values ever.**
  - `tsconfig.json` — `strict` (why it catches bugs), `target`/`module`; what turning strict off costs.
  - `vite.config.*`, `Dockerfile`, `.gitignore`, `next.config.*`, `eslint.config.*`/`.eslintrc`, `requirements.txt`, `Makefile`, `docker-compose.yml`, `tailwind.config.*`, `postcss.config.*`, `babel.config.*` — one bounded card each.
- **Unknown config** (matches `isConfigName`, no card): generic card — "this is a settings file; here's the pattern to spot what it controls" — never skipped, never crashes.
- **Unparseable** (bad JSON/YAML): "couldn't parse this yet — here's why" card with a fix hint (same shape as `deps.js` malformed-package.json finding).

`ConfigFile` shape: `{ path, name, kind, what, settings: [{ key, value, why, alternatives }], note? }` where `what` is the one-line "what this controls", `settings` holds the real pulled values, and `why`/`alternatives` are the teaching layer.

#### `suggestFiling(map) -> { groups: FilingGroup[], tips, clutterRef }`

- Classify every file by role via `classifyRole(name, path, text)`:
  - **name/path first** (fast, no read): `*route*`, `*handler*`, `*data*`, `*db*`, `*store*`, `components/`/`ui/`, `utils/`/`lib/`, config names → role.
  - **shallow sniff fallback** for `js|ts|jsx|tsx|py` without a name hit: read a bounded prefix (≤4 KB) and look for Express/route-registration smells (`app.get/post/use`, `router.`), `createServer`, SQL/ORM strings. Bounded + memoized; a massive app doesn't pay full-file reads it already paid for at map build.
- **Group by role.** For each role with **≥3 files**: if the files are **scattered** across more than one directory, emit a suggestion — role name, the file list, the suggested folder, and a one-line why. If they're **already under one directory**, emit a "good" note ("these 3 are already grouped in `src/handlers`"). Below 3 files: no noise.
- Suggested folders: handlers → `routes/`, data → `data/` or `db/`, render → `ui/` or `components/`, util → `lib/` or `util/`, config → `config/`.
- `tips`: 3–5 short best-practices lines, glossary-linked (keep the entry at root, name by role not by "file2", one purpose per file, keep secrets out of tracked files).
- `clutterRef`: count + category pointer to the existing clutter audit findings ("N clutter findings — see the Audit screen for the specifics") — the "extra tools" layer, not the headline.

### Screen — `src/tui/config.js`

Follows the established pure `render(state, { …data })` / `step(state, key, { …data })` contract (same as flow/glossary). Two views switched by `1` / `2` (header hint: `1 settings · 2 clean up · q back`):

- **View 1 — Settings:** framed list of config-file rows (name + `what` one-liner). `↑↓` move, `Enter` opens the detail view for the selected file. Detail shows the card + each pulled setting with its `why` and `you could also…`, glossary-linked, `g`/`?` glossary affordance consistent with other screens. Back to the list on `←`/`q`.
- **View 2 — Clean it up:** the `groups` list — each group is a role header, the member files, and the suggestion (or the "already grouped — good" note). A tips block. A dim line pointing at the clutter audit extras. Entry-point note: "your entry file stays where it is — this is about tidying the rest."
- `.env` row in Settings always renders the location-only card; nothing else ever touches it.

### Wiring

- `flow.js`: extract and export `classifyRole(name, path, text)` from the existing scan-role logic (behavior-preserving refactor; flow's own tests stay green).
- `src/tui/home.js`: 7th button `{ to: 'config', icon: '▣', label: 'Your setup', desc: 'See your settings & tidy the tree' }`. Grid math becomes **3×3** (7 buttons, trailing empty cells clamp — no phantom slot, no centered straggler, the pattern flow's review enforced).
- `src/tui/app.js`: `config` route; build lazily and memoize per project (flowCache-style) so home never stalls. Version bump to **0.1.8** on the release commit (house convention: features ship as 0.1.x patches).

### Safety constraints (non-negotiable)

- `.env` values never render and never enter any AI call.
- No file is written, moved, or deleted — by the config screen or anything it calls.
- All file reads via `readFileSafe`; all parsing try/caught; unknown + unparseable inputs render cards, never crash.

## Testing

`test/config.test.js` (data layer):
- package.json fixture: pulls `scripts`/`type`/`dependencies` correctly; `why`/`alternatives` present per setting; ordered first.
- tsconfig fixture: `strict` explained; strict-off cost shown.
- `.env` present: card is location-only — **assert no value text from the file ever appears in output**.
- unknown config file (matches `isConfigName`, e.g. `weird.yml`): generic card, no crash.
- malformed `package.json`: "couldn't parse" card, no crash, no thrown error.
- filing: 3+ scattered handlers → `routes/` suggestion; already-grouped files → "good" note; 2 files of a role → no noise; role classification resolves route handlers both by name and by Express-sniff.

`test/tui-config.test.js` (screen):
- View 1 renders the config list; Enter opens detail; back returns.
- View 2 renders groups + tips + clutter pointer.
- `1`/`2` switch views; `q` returns.
- `.env` detail never contains a value.
- Empty/edge input (no config files, no flow roles) renders gracefully.

`test/tui-home.test.js` (updated):
- 3×3 grid: all 7 reachable by arrows, empty cells clamp, no phantom slot, no straggler.

## Out of scope / parked decisions (web track)

These were decided in the design conversation and are **not** part of this feature, but are recorded so they aren't lost:
- **Web-track naming principle:** lead with understanding, tuck the security away. Not a "free secrets scanner" — position as "Get to know your repo / The app doctor" (paste a repo, get a plain-English tour + a heads-up on risky bits at the bottom). Drop "free" from the name.
- **Freemium cap:** the cap lives on the web product, not the CLI. Free = up to 3 projects scanned (deterministic tour + report); Pro = unlimited + AI-enriched explanations + saved reports (Stripe). The local CLI stays 100% free — it's distribution; metering a local tool isn't honest.
- **License:** currently AGPL-3.0. Fine while local-only; revisit (likely MIT) before shipping any hosted web product built on this code, because AGPL's network clause would pressure a paid SaaS to open-source. Kevin can relicense anytime — his code.
