# appwalk — handoff brief for AI assistants

> Read this to get fully up to speed on appwalk: what it is, what's built, how it works, and the open product questions I want your help with (monetization + beginner interface).

## The one-liner

**appwalk is a terminal tool that walks a person through their own app, front to back — the way a senior dev would on a guided tour — and teaches them the language (refactoring, auth, RLS, API keys…) as it goes.**

## The problem it solves

A fast-growing wave of people now "vibe-code": they ship real apps by prompting AI, but **don't understand the code underneath** and are anxious about two things:

1. *"Is my code full of junk?"* — dead files, duplicates, clutter, things that never got pruned.
2. *"Did I leak my keys?"* — API keys, database URLs, `.env` committed to git.

Existing tools (Cursor, Copilot, security scanners) all **assume the user can code**. appwalk assumes they can't and walks them to competence — while giving them the peace of mind that their app is clean and safe. That's the gap.

## What's built (all working, tested, live on the Pi)

A zero-dependency Node CLI (`node --test` = 40 passing tests). Run it inside any project:

| Command | What it does |
|---|---|
| `appwalk` | The **guided tour**: what the app is → how it starts → your folders → inside the entry file (**with git history**: "added 3 weeks ago, changed 14 times") → a **choose-your-model step** → what to watch. Works with **zero AI**. |
| `appwalk tree` | A **clickable file-map browser** in the terminal: arrow keys, Enter opens a file, duplicate/merge markers shown. |
| `appwalk audit --report` | **Secrets** (masked, never raw), **duplicates** ("these could be merged"), **clutter** (.bak/.tmp/todo-only), **deps** (unused/missing lockfile), **git hygiene**. `--report` writes a shareable HTML. |
| `appwalk monitor` | Runs the app, tails logs, flags crash signatures. |
| `appwalk explain <file>` | **Live AI explanation** of any file in plain language. |
| `appwalk glossary` | The **term teacher**: ~24 plain-language entries (what it is / why it matters / when you'd use it). |
| `appwalk doctor` | Self-check. |

## Architecture (the clever part)

**Deterministic core + BYO-key AI.** Everything except `explain` runs with **zero AI and zero cost** — the map, tour, audit, glossary, monitor, and report are rule-driven. AI is a pluggable layer the user brings their own key to:

- **Providers wired + verified** against real API responses: Anthropic (`claude-sonnet-5` lite / `claude-opus-5` pro), DeepSeek (`deepseek-v4-flash`), local Ollama (`llama3.2:3b`, free), Claude Code CLI.
- **Cost-transparent**: every AI answer shows the **model + real token count + cost**. The walkthrough's "choose your model" step teaches lite vs pro vs local vs Claude Code — **what each is good at**, cost, and how to wire it. A Claude Code power user discovers they don't need a paid model for a "what does this mean?" question.
- **The `.env` is shown as a location, never its values** — in every mode.

## Why it's buildable and sellable

- **Near-zero marginal cost**: users bring their own AI key; the deterministic core costs nothing.
- **The market is real and growing**: AI-shipped apps whose owners can't explain a single file.
- **It dogfoods real experience**: the author has been doing exactly this audit methodology by hand for weeks.

## The current state

- Spec + 13-task implementation plan, executed via subagent-driven development with per-task review (35→40 tests, final review READY).
- Live on Kevin's Pi at `~/appwalk`, key wired, verified working (`appwalk` tour + `appwalk explain` both demoed live).
- The codebase is small, clean, zero-dependency, ESM.

## Open questions I want your help with

### 1. Monetization (primary)
- **Freemium** seems obvious: free = tour + tree + glossary + secrets scan; **paid** = full audit (duplicates/deps/git), monitor, HTML report, AI quota. What's the right price, one-time vs subscription, and where's the line between free and paid?
- **Distribution**: `npx appwalk`? A paid npm package? A website with a demo? Landing page? TikTok/Shorts content (the author runs an air-fryer content channel — could do a "code walkthrough" channel)?
- **Who pays**: individual vibe-coders? Bootcamp students? Agencies that ship AI apps to clients and need to hand over "clean + explained" code? The last one is an interesting B2B angle.
- **The honest-credits angle as marketing**: "your walkthrough is free, AI only costs if you ask, and we show the price every time" is a trust story most AI tools don't tell.

### 2. The beginner interface (secondary)
- The tool runs in the terminal (Termius). How "GUI-like" should it get? (A home/menu screen, a real expandable folder tree, panels/borders/colors, syntax highlighting, a status bar.)
- What makes a *new coder* feel confident vs intimidated in a terminal UI? (Clear prompts, "press Enter to continue", progress, no jargon, praise/encouragement.)
- Should there be a web version eventually, or is terminal-first the right call for credibility + zero hosting cost?

## If you want to see it

- `~/appwalk` on the Pi (Node 20+, `npm test` = 40 pass).
- `appwalk walk` inside any project → the tour.
- `appwalk explain <file>` → live AI explanation.

---

*Written 2026-08-01. Live repo at ~/appwalk; spec at docs/superpowers/specs/2026-08-01-appwalk-design.md; plan at docs/superpowers/plans/2026-08-01-appwalk.md.*
