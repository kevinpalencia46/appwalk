# appwalk FAQ

Named anchors let the CLI point at a specific answer — errors carry a short
`(FAQ: <anchor>)` suffix, and this file keeps those anchors stable.

## Installation & running

<a name="command-not-found"></a>
**`command not found: appwalk` after install**
If you used `npx appwalk`, npx downloads it on demand — no install step. If you installed globally (`npm i -g appwalk`) and still get `command not found`, your npm `bin` directory isn't on PATH. Find it with `npm bin -g` and add it to your shell, or just keep using `npx appwalk`.

<a name="node-too-old"></a>
**"Node version too old"**
appwalk needs Node 20 or newer. Check with `node -v`. If you're on 18 or older, update: `nvm install 20` (if you use nvm) or download the current LTS from nodejs.org.

<a name="windows"></a>
**I'm on Windows / PowerShell**
Use WSL (Windows Subsystem for Linux) for the full experience — the interactive shell (colors, arrow keys, the framed screens) works best there. In plain PowerShell you can still run `appwalk audit --report` and `appwalk explain <file>`, but the interactive menu may not render correctly.

## AI & the "bring your own key" stuff

<a name="api-key"></a>
**What is an API key, and where does it go?**
An API key is a secret token that lets a program call a paid service (Anthropic, DeepSeek, etc.). In appwalk, your key lives in a `.env` file next to the tool — `AI_PROVIDER` names the service and `AI_API_KEY` is the key itself. The walkthrough's "choose your model" step walks you through it. Your key is never sent anywhere except to the provider you named.

<a name="privacy"></a>
**Does appwalk send my code anywhere?**
No. The tour, tree, audit, glossary, and monitor all run entirely on your machine — your code never leaves it. The only exception is `appwalk explain <file>`, which sends **only the file you name** to the AI provider you configured. Everything else is local.

<a name="cost"></a>
**What does this cost me in AI credits?**
The core costs **zero** — no AI is used, and the tool says so at every step. AI explanations are opt-in: you bring your own key, the default is a cheap "lite" model, and every answer shows the model, real token count, and exact price before you commit. A "what does this mean?" question on the lite model costs fractions of a cent.

<a name="no-ai"></a>
**I don't want to set up any AI at all**
You don't have to. The tour, tree, audit, glossary, and doctor all work with no key. AI only powers `explain` (and error explanations in monitor). Skip it entirely and you still get the full walkthrough + safety audit.

<a name="ai-failed"></a>
**`[AI call failed …]` / it says to check `AI_PROVIDER` / `AI_API_KEY`**
The provider line or key in `.env` is wrong, or the provider was unreachable. Fix the two lines (`AI_PROVIDER` + `AI_API_KEY`), then run `appwalk doctor` to self-check. The tour, tree, audit and glossary never touch the network — they keep working with or without a key.

## I found a key in my repo — what do I do now?

<a name="key-in-repo"></a>
**Rotate first.** Go to the service (Stripe, AWS, GitHub, whatever the key is for) and revoke/rotate it *before* doing anything else. A key that's been committed is already compromised — someone may have copied it. Rotating kills it.

**Then gitignore it.** Add `.env` (and the key's file if it's a different one) to `.gitignore` so it can't be committed again.

**Then purge history.** Gitignoring alone does NOTHING for a key already committed — it's still in every old commit. If the repo is public or shared, treat the key as burned (which is why you rotated). Purging git history (`git filter-repo` or BFG) removes it from old commits, but anyone who already pulled it still has it — which is exactly why rotation is step one.

Order matters: **rotate → gitignore → purge**, never gitignore alone.

## Troubleshooting

<a name="no-files-found"></a>
**`appwalk` says "no files found"**
The folder you ran it in is empty, or everything in it is being skipped. appwalk skips `node_modules`, `.git`, `dist`, `.next`, build folders, virtualenvs and dotfiles, plus anything listed in your `.gitignore`. Run it in the top-level folder of your project, not an empty directory or a subfolder that's all ignored files.

<a name="usage"></a>
**`appwalk: unknown mode "…"` / "usage:"**
That command isn't a mode appwalk knows. Run `appwalk` with no arguments for the guided shell, or `appwalk help` for the full list: `tree`, `audit`, `monitor`, `explain <file>`, `glossary [term]`, `doctor`. For `appwalk explain`, the file argument is required: `appwalk explain src/index.js`.

<a name="glossary"></a>
**`no term "…"` from `appwalk glossary`**
The word you asked about isn't in the glossary. Run `appwalk glossary` with no arguments to list every term, or try a different word (the list includes refactoring, auth, RLS, API key, environment variable, dependency, deploy, and more).

<a name="monitor"></a>
**`monitor` can't run my app / "failed to start"**
`appwalk monitor` only knows how to start Node (`npm run dev`), Python (`python main.py`) and static-site (`python -m http.server`) projects. If your app doesn't match one of those, monitor has no command to run — use `appwalk walk` to explore it instead. If the command exists but the app fails to start, that failure is usually the app itself telling you something is misconfigured (a missing dependency, a wrong port, a bad env var).

<a name="audit"></a>
**A finding or the audit screen looks wrong**
The audit never prints `.env` values, and a clean category (0 findings) is a good thing — the score line counts how many of the five categories are clean. If a finding's fix doesn't make sense for your case, that's the right moment to ask an AI assistant for help: every finding detail screen has a copy-ready "ask your AI" prompt.

## Refunds

<a name="refunds"></a>
**I bought a paid tier and it's not for me**
Try appwalk free first — the core needs no payment. If you bought a paid tier and it's not for you, email the address in the README within 30 days for a full refund. No questions.
