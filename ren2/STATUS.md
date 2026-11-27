# Ren 2 — STATUS

_Last updated 2026-11-27 · build: M1–M4 done in the cloud, M5 (Pi deploy) scripted and tested on x86 only._

## Needs Kevin

Everything below is optional for Ren 2 to run. Each missing item shows as
`needs_credentials` / `needs_config` / `MOCK` in the dashboard, never as fake success.

1. **Telegram bot.** Create one with @BotFather, then put `TELEGRAM_BOT_TOKEN` and your numeric
   `TELEGRAM_CHAT_ID` in `.env`. Until then, Telegram has only been tested against a local
   fake Bot API.
2. **Model keys** (any subset): `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `KIMI_API_KEY`. Without
   them, the router uses the headless Claude Code CLI (your own login) and Ollama, if installed.
   Also check the per-token prices in `config/models.yaml` (marked VERIFY). Kimi's endpoint and
   model id are unverified.
3. **Ollama on the Pi** (`llama3.2:3b`, optionally `nomic-embed-text`) for free local
   summaries. It is not running in the cloud build.
4. **Real API routes** for each side project, as a route list or read access to its code:
   Builder (8400), Storefront (8200), Showrunner (8300), Growth Engine (8601), Meme Scanner
   (8500), Trading OS (8000), Old Ren (8100). Live adapters refuse to guess routes; every
   adapter runs in MOCK mode until these arrive.
5. **The first social platform** for Content to publish to (X, Instagram, Facebook, LinkedIn
   or TikTok), plus its credentials. Until then Content is drafts-only: approved posts stay
   on the dashboard to copy by hand.
6. **Old Ren knowledge path.** Set `OLD_REN_KNOWLEDGE_PATH` (and `PROJECT_DOCS_PATHS`), then run
   `npm run import-knowledge` once.
7. **Old Ren "Fleet" CSS.** Point me at it if you want the dashboard closer to the old look.
   The current graphite/orb theme is built from the brief's description.
8. **Research sources.** Competitor or marketplace URLs to scan go in
   `agents/research.yaml → sources`. The list is empty now, so Research works from Storefront
   data and memory only.
9. **Pi deploy.** On the Pi, run `bash scripts/install-pi.sh`, then
   `sudo loginctl enable-linger $USER`. See `docs/DEPLOY_PI.md`.

## What works (verified)

- **Core:** one process (`node:http`), one SQLite DB (built-in `node:sqlite`, FTS5), SSE live
  stream, dashboard and owner-token login. RSS is about 60–70 MB.
- **Model router:** `config/models.yaml` routes per kind (chat, plan, write, research, code,
  cheap-summarize, embed) with fallback. Providers: Anthropic, DeepSeek, Kimi (unverified),
  Ollama, Claude Code CLI.
- **Budget:** every call's cost is logged. Daily cap ($5 default) and per-agent caps. A warning
  goes to Telegram at 80%. At 100%, cloud calls pause and local models keep running; the cap
  can be raised with `/budget <usd>` or from the System page.
- **Tasks:** queued → planning → running → verifying → done | failed | needs_decision. Restart
  resume was tested with `kill -9` mid-task: the task resumes at the step that was running, and
  completed steps don't re-run. Adapter actions are idempotent per step key. When the same task
  fails 3 times, Ren 2 creates one recurring-failure item with a diagnosis, pauses the agent's
  schedule and notifies once. Done tasks archive after 30 days and are never deleted.
- **Tools:** shell (timeouts, output caps, no secrets in env, 1 heavy + 3 light slots, fewer
  under load), files (workspace + own repo; Destroy gate outside), http (public GET; non-GET
  only to an allowlist; private hosts refused), claude_code (git worktree → branch + summary +
  tests), mcp_client (Streamable HTTP; VERIFY against a live server), memory, think, handoff,
  notify, adapter, publish, system. Each tool reports its status honestly.
- **Memory:** knowledge table plus FTS5, markdown notes in `knowledge/` indexed on change (30 s
  poll), notes editable from the dashboard (writes the file), planner context limited to about
  2.4k chars, one-time import script that skips files that look like they contain secrets.
- **Gates:** money, publish, contact and destroy, and nothing else. Decisions come with
  Approve, Edit, Reject and Always allow this. Edit has the agent revise the draft and ask
  again. Always allow writes to the agent's YAML `auto` list (comments preserved) and can be
  reverted from System. Decisions never auto-approve. After 48 h a pending decision is marked
  stale and gets one reminder.
- **Kill switch:** `/stop` or the dashboard button halts in-flight work immediately; `/resume`
  continues from the last completed step. Tested.
- **Telegram:** long polling, chat-locked, free text goes to the planner, plus `/status`
  `/agents` `/pause` `/resume` `/stop` `/budget` `/decisions` `/new`. Decision buttons, edit by
  reply, a daily digest (20:00), and immediate alerts for budget and recurring failures.
- **Agents (all five produced real end-to-end results on 2026-11-27 using the Claude CLI):**
  - **Ops:** health, adapters, queue jams and a report. Needs no model.
  - **Research:** Storefront funnel analysis (on MOCK numbers, and it says so). Findings are
    saved as a lesson and handed to Content.
  - **Content:** draft post, then a 30-second script, then a Showrunner job (mock), then the
    Publish gate.
  - **Sites:** spec, then a real local preview page at `/previews/…`, then the link to
    Telegram, then the Publish gate for going live.
  - **Outreach:** prospects (fixtures), then personalized drafts saved in BGE (mock), then one
    Contact decision for the batch.
  - **All agents:** weekly retro (Mon 07:00) proposes a new playbook version, which is applied
    automatically, versioned and revertible in one click. The digest lists playbook changes.
    Start, pause, stop, run now, edit config, and create an agent from the dashboard.
- **Dashboard (6 pages):** Home (orb, chat, current work, decisions with buttons, alerts,
  spend, results), Work (filters, task detail with plan, steps, output, cost and report,
  retry/dismiss, recurring failures), Agents, Projects (adapter status, honest numbers labelled
  MOCK), Memory (search/browse/edit, decisions, drafts), System (health, models, tools,
  Telegram, publishers, budget, always-allow list, kill switch). Laid out for iPad; on a phone
  there is no horizontal scroll.
- **Tests:** `npm test` passes 46 `node:test` tests across 6 files, covering every endpoint.
  `npm run smoke` runs the real process end to end: the M1 demo over a fake Telegram, a
  `kill -9` resume, and the kill switch.

## Stubbed / mock (honest)

- **Project adapters:** all MOCK (fixtures in `fixtures/`, labelled MOCK everywhere). Live mode
  checks whether the service is reachable and refuses every method with "routes not mapped"
  until item 4 above arrives.
- **Builder mock:** renders a real static preview locally, but "go live" deploys nothing.
  Showrunner's mock queues jobs but renders nothing. BGE's mock "send" sends no email.
- **Publishers:** drafts-only works. X, Instagram, Facebook, LinkedIn and TikTok show
  `needs_credentials`, and their publish call isn't written yet (VERIFY once a platform is
  picked).
- **Retro metrics:** approvals, rejections, edits and task outcomes are real. Engagement,
  replies, visits and conversions wait on live adapters.
- **TTS:** Piper and ElevenLabs are not wired (not needed by any agent yet).
- **Embeddings:** Ollama `nomic-embed-text` is routed in config but not used; FTS5 only for now.

## Blocked

- **Real Pi run:** ARM64, temperature sensor, systemd user unit and Tailscale binding haven't
  been tried on the device. The installer ran on x86 with `REN2_ALLOW_ANY_ARCH=1`, but systemd
  wasn't available there.

## Next

1. Get the Telegram token and chat id, and confirm the M1 demo on the real bot.
2. Map the Storefront API, then switch it to live and re-run Research on real numbers.
3. Install on the Pi (`scripts/install-pi.sh`) with Ollama running locally.
4. Pick the first social platform and wire its publisher.
5. Map Builder and Growth Engine, so Sites deploys for real and Outreach drafts land in the
   real CRM.

## Notes on decisions made

- **Location:** Ren 2 lives in `ren2/` inside the `appwalk` repo, as Kevin asked ("use appwalk,
  keep it separate"). Nothing outside `ren2/` was touched, and it has its own `package.json`.
  It can move to its own repo unchanged.
- **Runtime dependency:** `yaml` (pure JS) is the only one. Agent configs are YAML per the brief,
  and editing them while keeping comments needs a real parser.
- **HTTP server:** plain `node:http` rather than Fastify, to keep zero native dependencies and a
  small footprint.
- **Node version:** the brief says Node 22+. `node:sqlite` needs 22.5+ (22.13+ for no flag), and
  the installer checks for it.
- **Built-in agent plans:** the five built-in agents plan deterministically from their playbook
  steps, which is cheaper and more reliable. Agents created from the dashboard are planned by
  the model from their mission.
