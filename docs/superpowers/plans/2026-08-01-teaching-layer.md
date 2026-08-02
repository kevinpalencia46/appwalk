# appwalk teaching layer — implementation brief

> Dispatch as one subagent task (it's one coherent "teach the language" pass). Source: Kevin's walkthrough notes, batch 2. Repo: ~/appwalk, zero-dep, 72 tests green.

## 1. Explain-on-open — "about this file" panel (viewer)

When a file opens in the viewer (`o` from the tour, Enter from the tree, or the file-picker), render a **right-hand "About this file" panel** that teaches, in plain words:

- **What kind of file it is.** Per-language one-liners: `.json` → "a settings file — the ID card for your app"; `.js` → "JavaScript — the code that makes your app behave"; `.py` → "Python — another language apps are written in"; `.html` → "the page structure your browser reads"; `.css` → "the styling — colors, fonts, layout"; `.md` → "plain-text notes/readme".
- **Why it says "408 bytes"** (the size). "That's how much text is in the file — 408 bytes is small, like a sticky note. Big files (100KB+) usually mean a lot is happening in one place."
- **For package.json specifically**: explain `scripts` ("commands you can run, like `npm run dev`; each one is a shortcut for a longer command. You'd add one when you find yourself typing the same command over and over"), and `dependencies` ("libraries your app relies on — code other people wrote that you 'install' into your project. Fewer is safer; each one is code you're trusting").
- **General shape:** each item is "what it is / why it matters to you / when you'd use it", matching the glossary voice.

**Implementation:** a new pure module `src/tui/about.js` exporting `aboutFile(node) -> string[]` (the panel lines). The viewer's `render` adds the panel beside the file content (reuse the glossary's `sideBySide` from kit.js or duplicate a small version). A test: `aboutFile` on a package.json node mentions scripts and dependencies; on a .js node explains JavaScript.

## 2. Fluid wording + "try it" — the tour

- **Rewrite the tour body copy** in `src/walkthrough.js` to be more fluid and analogy-first: "think of this as…" for the stack ("a Node.js app is like a restaurant — `package.json` is the menu of what it can do, `src/` is the kitchen"). Keep it short.
- **"Try it" interaction:** add a `t` key to the TOUR screen that runs a suggested command and shows the output in a small box below the step. For a node project: step 2's suggested command is `cat package.json` (or `npm run`); step 4 (inside package.json) could be `node -e "console.log(1+1)"` to show a program actually running. The tour's `step` returns `{ to: 'try', params: { cmd, back: 'tour' } }` — a tiny new screen `src/tui/try.js` that runs the command via `child_process.execFile` (args array, no shell injection), shows stdout/stderr in a framed box, and Enter returns to the tour. Guard: the command is chosen by appwalk itself from a small allowlist (never user-typed); `q`/Enter exit the try box.
- **Test:** try.js render shows the command and its (injected) output; the tour step `t` returns the try route with a known-good command for the detected stack.

## 3. Choose-AI step — install instructions + security warnings

Expand `src/ai/educate.js`'s text (the walkthrough's model step) so each tier includes:
- **How to actually set it up** — for lite (anthropic): "paste your key into `.env` as AI_API_KEY"; for local (Ollama): "install Ollama from ollama.com, then run `ollama pull llama3.2:3b` — it runs entirely on your machine, free and private".
- **Security warnings:** API keys are secrets — never commit them, never paste them into a chat that will store them, `.env` is gitignored for a reason. For Ollama: "needs a machine with decent RAM (4GB+ free); skip local models on a low-memory device — use the cloud lite tier instead". When NOT to install: "if you're on a phone/tablet or a low-spec laptop, skip local models entirely".
- Keep the existing cost/honesty framing; this is an expansion, not a rewrite. Test: educateText still matches /lite/ /pro/ /local/ and now also /ollama pull/ and /never commit/.

## 4. Security teaching — .env, rotating, and "ask your AI to fix this"

- **`.env` in the tree** (the location-only row) and the viewer's `.env` guard should include a short teach-line: "why: this file holds secrets (API keys, passwords). Keep it gitignored — commit it and anyone can read them."
- **Audit secret findings**: rewrite the `fix` strings in `src/audit/secrets.js` to explain *rotating* properly: "This key has been committed — treat it as leaked. Rotate it: at the provider (Stripe/AWS/etc), revoke it and issue a new one; put the new key in `.env`; then gitignore `.env` and purge history (git filter-repo) so old commits stop exposing it. Gitignoring alone does NOTHING for a key already committed."
- **"Ask your AI to fix this"** — the audit detail view (src/tui/audit.js renderDetail) gains a copy-ready line under the fix: `ask your AI: "I have a leaked <kind> in <file>:<line>. Walk me through rotating it, gitignoring .env, and cleaning up."` A `c` key in the detail view copies that prompt to the system clipboard when possible (best-effort `xclip`/`wl-copy`, degrade silently), and always displays it so a beginner can copy by eye. Test: renderDetail shows the ask-your-AI line for a secret finding.

## Global constraints (all four)

- Zero-dep, ESM, pure render/step per screen (I/O only in the shell + the new try.js, which is the sanctioned exception for running appwalk-chosen commands).
- `.env` values never rendered anywhere.
- Existing 72 tests stay green; add tests for: about.js, try.js, educateText expansion, audit ask-your-AI line.
- One commit (or two if the try.js screen warrants separation). Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
