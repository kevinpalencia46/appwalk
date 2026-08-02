# appwalk — handoff for AI assistants (updated 2026-08-01)

> Paste this into Claude chat to get fully up to speed. The product has shipped and evolved — this is the current, live state.

## What it is

**appwalk-cli** (published on npm as `appwalk-cli@0.1.1`) is a terminal tool that walks a person through their own app, front to back — the way a senior dev would on a guided tour — and teaches them the language (refactoring, auth, RLS, API keys…) as it goes. Built for people who "vibe-code": they shipped real apps with AI but don't understand the code underneath and worry their code is junk or they leaked their keys.

Run it anywhere: `npx appwalk-cli`. Zero install, zero dependencies, works with no AI key.

## What's built (all live, 89 tests)

**The shell** — `appwalk-cli` opens a framed, app-like terminal menu (home): tour · tree · audit · ask · glossary. A zero-dependency ANSI TUI (hand-written, no libs), built for beginners: big boxes, prominent "Press ENTER", a small ASCII mascot, `h` = home from anywhere.

- **Guided tour** — one framed step at a time, Enter to continue, `o` opens the file, `g` glosses a term, **`t` runs an appwalk-chosen command in a small box so you see it work** (allowlisted, injection-safe).
- **Explain-on-open** — opening a file shows a right-hand "About this file" panel: what the file type is, why it says "408 bytes", and for package.json what scripts + dependencies are and why you'd add one.
- **Folder tree** — expandable, entry points green, `.env` shown as *location only* (values never rendered, in any mode).
- **Audit** — a checklist with a score ("3 of 5 clean"), red only for real secrets, **every finding carries a plain fix**, and a copy-ready **"ask your AI to fix this"** prompt (`c` key). Covers secrets, duplicates, clutter, deps, git.
- **Glossary** — split view: terms on the left, definition on the right, live as you arrow, only terms seen so far.
- **AI layer (bring your own key)** — `appwalk-cli explain <file>`: Anthropic (claude-sonnet-5 lite / claude-opus-5 pro), DeepSeek, local Ollama, Claude Code CLI. The core runs with ZERO AI; AI is opt-in and shows its real token count + cost every time. The choose-your-model step teaches lite vs pro vs local vs Claude Code — what each is good at, cost, and how to wire it.
- **Security teaching** — `.env` explained everywhere, audit fixes explain *rotating* properly (rotate → gitignore → purge history, in that order), plus a copy-ready "ask your AI to fix this" prompt on every finding.
- **doctor --report** — copy-pasteable masked issue block. **Local instrumentation** (`~/.appwalk/stats.json`) to measure which feature is the paid hook — no telemetry home.
- **README + FAQ** — the honest-credits story front and center ("your walkthrough is free, AI only costs if you ask, and we show the price every time").

## Architecture

Node 20+ ESM, zero runtime deps. `src/tui/` is the ANSI shell (pure `render(state,data)` + `step(state,key,data)` per screen + a shell loop); `src/audit/`, `src/tree.js`, `src/walkthrough.js`, `src/glossary.js` are the data layer; `src/ai/` is the BYO-key layer; `src/tui/try.js` is the sanctioned I/O exception (runs appwalk-chosen commands). Terminal-escape injection is neutralized everywhere (a shared `sanitize()`).

## Monetization plan (from the earlier brief — settled)

- **One-time purchase** $39 for the paid tier; **secrets scan stays free forever** (it's the trust moment).
- Two tracks: **agencies** ("Ship it with receipts" — the HTML report is a client deliverable) and **individuals** ("You shipped it. Now understand it.").
- Free = tour, tree, glossary, secrets scan, doctor. Paid = full audit (duplicates/deps/git), `--report` HTML, monitor, AI quota.
- License: **AGPL-3.0** (decided).
- Instrumentation decision rule: if <20% of users configure an AI key, `explain` is not the paid hook — the audit + HTML report is. Measure, don't guess.

## Current status

- **Live on npm**: `appwalk-cli@0.1.1` — `npx appwalk-cli` works. (The bare name `appwalk` is blocked by npm's anti-typosquatting rule against the old `app-walk` package; `appwalk-cli` is the permanent identity.)
- **The shell + teaching layer are done and reviewed.** 89 tests, subagent-driven with per-batch review; every Critical/Important bug caught and fixed.
- Repo: `~/appwalk` on the Pi. Run `node ~/appwalk/bin/appwalk.js` to try it live; `cd ~/appwalk && npm link` then `appwalk` for the clean command.

## Aesthetics — where Kevin wants your help

Kevin wants to work on the **visual design** of the terminal UI. It currently looks functional-but-plain (framed boxes, a fixed palette: green good / blue info / yellow watch / red danger). The TUI is the marketing — people share a 20-second capture of a beautiful thing scanning their project. Help with:
- A **distinctive visual identity** for the terminal UI that still works in ANSI (borders, glyphs, spacing, palette, the mascot) — something worth a screenshot/TikTok.
- **Typography/spacing polish** in the framed screens.
- The **mascot character** design.
- Whether any of it translates to the **landing page** (which isn't built yet).

## Next up (the funnel, not built)

1. **Free web secrets scanner** — paste a public GitHub URL → instant leaked-secrets scan, no signup. The shareable "oh god" moment; the fix is "install the CLI." Reuses the existing audit/secrets scanner.
2. **Landing page + recorded terminal demo** (asciinema or screen capture, 9:16-crop friendly for Shorts).
3. **Payment gate** (Polar or Lemon Squeezy) behind the paid tier.

---

*Live repo: ~/appwalk · spec: docs/superpowers/specs/ · plans: docs/superpowers/plans/ · npm: appwalk-cli@0.1.1*
