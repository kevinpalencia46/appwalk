# appwalk FAQ

## Installation & running

**`command not found: appwalk` after install**
If you used `npx appwalk`, npx downloads it on demand — no install step. If you installed globally (`npm i -g appwalk`) and still get `command not found`, your npm `bin` directory isn't on PATH. Find it with `npm bin -g` and add it to your shell, or just keep using `npx appwalk`.

**"Node version too old"**
appwalk needs Node 20 or newer. Check with `node -v`. If you're on 18 or older, update: `nvm install 20` (if you use nvm) or download the current LTS from nodejs.org.

**I'm on Windows / PowerShell**
Use WSL (Windows Subsystem for Linux) for the full experience — the interactive shell (colors, arrow keys, the framed screens) works best there. In plain PowerShell you can still run `appwalk audit --report` and `appwalk explain <file>`, but the interactive menu may not render correctly.

## AI & the "bring your own key" stuff

**What is an API key, and where does it go?**
An API key is a secret token that lets a program call a paid service (Anthropic, DeepSeek, etc.). In appwalk, your key lives in a `.env` file next to the tool — `AI_PROVIDER` names the service and `AI_API_KEY` is the key itself. The walkthrough's "choose your model" step walks you through it. Your key is never sent anywhere except to the provider you named.

**Does appwalk send my code anywhere?**
No. The tour, tree, audit, glossary, and monitor all run entirely on your machine — your code never leaves it. The only exception is `appwalk explain <file>`, which sends **only the file you name** to the AI provider you configured. Everything else is local.

**What does this cost me in AI credits?**
The core costs **zero** — no AI is used, and the tool says so at every step. AI explanations are opt-in: you bring your own key, the default is a cheap "lite" model, and every answer shows the model, real token count, and exact price before you commit. A "what does this mean?" question on the lite model costs fractions of a cent.

**I don't want to set up any AI at all**
You don't have to. The tour, tree, audit, glossary, and doctor all work with no key. AI only powers `explain` (and error explanations in monitor). Skip it entirely and you still get the full walkthrough + safety audit.

## I found a key in my repo — what do I do now?

**Rotate first.** Go to the service (Stripe, AWS, GitHub, whatever the key is for) and revoke/rotate it *before* doing anything else. A key that's been committed is already compromised — someone may have copied it. Rotating kills it.

**Then gitignore it.** Add `.env` (and the key's file if it's a different one) to `.gitignore` so it can't be committed again.

**Then purge history.** Gitignoring alone does NOTHING for a key already committed — it's still in every old commit. If the repo is public or shared, treat the key as burned (which is why you rotated). Purging git history (`git filter-repo` or BFG) removes it from old commits, but anyone who already pulled it still has it — which is exactly why rotation is step one.

Order matters: **rotate → gitignore → purge**, never gitignore alone.

## Refunds

Try appwalk free first — the core needs no payment. If you bought a paid tier and it's not for you, email the address in the README within 30 days for a full refund. No questions.
