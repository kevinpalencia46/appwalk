# appwalk

**Walk a person through their own app — the guided tour + safety audit for code you didn't write.**

You shipped it with AI. Now understand it.

`appwalk` is a terminal tool that walks you through your own app, front to back, the way a senior dev would on a guided tour — and teaches you the language (refactoring, auth, RLS, API keys…) as it goes.

```
┌─ appwalk ─────────────────────────────────────────────┐
│   👋  Hi! I'll help you understand your app.           │
│      Looking at:  great-pacific-plumbing               │
│                                                       │
│   ▶  🚶  Take the guided tour                          │
│      🗂  Explore your files                            │
│      🛡  Audit for safety & junk                       │
│      💬  Ask about a file                              │
│      📖  Learn the words                               │
└───────────────────────────────────────────────────────┘
```

## Run it

```bash
npx appwalk-cli        # no install, works in any project
```

No account. No AI key needed for the core. Zero dependencies.

## What it does

| Command | What |
|---|---|
| `appwalk` | The shell: home menu → guided tour · file tree · audit · ask · glossary |
| `appwalk tree` | Expandable folder browser — entry points green, `.env` as *location only* |
| `appwalk audit` | Secrets (masked, never raw) · duplicates ("candidates to merge") · clutter · deps · git hygiene. `--report` writes a shareable HTML |
| `appwalk explain <file>` | AI explanation of any file (bring your own key) |
| `appwalk monitor` | Run the app, watch logs, flag crashes |
| `appwalk glossary` | The term teacher: what it is / why it matters / when you'd use it |
| `appwalk doctor` | Self-check + copy-pasteable issue report |

## The honest-credits promise

- **The walkthrough, tree, audit, glossary, and doctor run with zero AI — they cost you nothing.** The tool says so at every step.
- **AI is opt-in.** You bring your own key (`AI_PROVIDER` + `AI_API_KEY` in `.env`), and every answer shows the model, real token count, and exact price — before you commit.
- **The choose-your-model step teaches you lite vs pro vs local vs Claude Code**: what each is good at, what it costs, how to wire it. That choice is exactly what vibe-coders are never taught.
- **Your `.env` is shown as a location, never its values.** In every mode.

## Safety first

The **secrets scan is free forever.** It's the "oh god" moment — the one that tells you whether the credentials you worried about are actually committed. If appwalk finds a leaked key, it explains *why it matters* and *how to fix it* (rotate first, then gitignore, then purge history — in that order).

## Bring your own AI (optional)

```bash
cd ~/appwalk && echo "AI_PROVIDER=anthropic" > .env   # or deepseek / ollama / claude-code
# add AI_API_KEY=... to .env
```

Providers: Anthropic (`claude-sonnet-5` lite / `claude-opus-5` pro) · DeepSeek (`deepseek-v4-flash`) · Ollama (free, local) · Claude Code CLI.

## Requirements

Node 20+. Works on macOS, Linux, Windows (WSL). Terminal with ANSI color (everything does).

---

Made for people who shipped something with AI and want to *understand* it. Questions? See [FAQ.md](FAQ.md).
