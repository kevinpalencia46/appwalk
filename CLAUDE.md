# appwalk — walk your app, understand your code

A terminal CLI that guides a person through their own app front-to-back: how it starts,
what each folder does, the main flow, what's broken or risky — and teaches the language
(refactoring, RLS, auth, …) as it goes. Built for vibe-coders who shipped an app with AI
but don't understand the code underneath.

**Design:** `docs/superpowers/specs/2026-08-01-appwalk-design.md` (approved 2026-08-01).

## Principles (from the spec — do not drift)

- **Deterministic core, AI enhancement.** Tree, walkthrough, audit scans, glossary, and
  report work with ZERO AI. The `ai` module is pluggable + bring-your-own-key
  (Anthropic | DeepSeek | local Ollama | Claude Code) and only enriches explanations.
  An AI key must NEVER be required for the core to work.
- **Teach the language.** Every concept the tool touches links to a plain-language
  glossary entry: what it is + why it matters + when you'd use it.
- **History-aware.** File explanations can use git history ("added 3 weeks ago for X;
  changed 14 times"). Degrade gracefully when there's no git.
- **The `.env` is shown as a location, never its values** — in every mode.
- **Node 20+, ESM, zero runtime deps.** ANSI TUI by hand. `node:test` per module.

## Modes

`appwalk` (guided tour) · `tree` (file map browser) · `audit [--json|--report]` ·
`monitor` · `explain <file>` · `glossary [term]` · `doctor`

## Secrets / API keys

Missing credentials must not halt the build. `AI_API_KEY` / `AI_MODEL` /
`AI_PROVIDER` live in `.env` (gitignored); `.env.example` is the committed blank
template. The AI layer must degrade to the deterministic answer when a key is absent.

## Working rules

- One spec/plan per feature; small commits; reviewer is native Claude.
- Never invent API field names — fetch real JSON or leave a `# VERIFY` marker.
- Keep secrets in `.env` only. Never commit `.env`.
- If a decision here seems wrong, say so in the commit — don't silently redesign.

## Status

All modes + the appwalk shell (home menu, interactive tour, folder tree, file viewer with syntax coloring, audit + glossary screens) shipped 2026-08-01. Run `appwalk` (no mode) for the shell; explicit modes still work for scripting. `npm test` = 54 tests.

AI explanations are LIVE (2026-08-01): providers wired + verified against real API responses (anthropic claude-sonnet-5/opus-5, deepseek-v4-flash, ollama llama3.2:3b, claude-code CLI). Set AI_PROVIDER + AI_API_KEY in .env. Run `node bin/appwalk.js doctor` to self-check.
