# Ren 2 — STATUS

_Last updated 2026-11-27 · Ren is now the head (HQ, sectors, delegation) · build: M1–M4 done in the cloud, M5 (Pi deploy) scripted and tested on x86 only, plus work desks (agents working on their own and together)._

## Needs Kevin

0. **Media niches.** Add them to `config/sectors.yaml` under `media → niches`. Until then Media
   picks the best-performing niche from analytics and says so, and Ren keeps asking. Also
   check the sector goals and targets in that file; they're my first guess from your
   description.
0. **Showrunner, Builder and Storefronts (Worklane) API routes** are the most valuable to map
   first. The live routes needed are: Showrunner video/clips/thumbnail/publish/analytics,
   Builder sweep/candidates/create_site/outreach, and Storefronts properties/summary/signups.
   Until then everything runs on MOCK fixtures.

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
- **Tests:** `npm test` passes 53 `node:test` tests across 7 files, covering every endpoint.
  `npm run smoke` runs the real process end to end: the M1 demo over a fake Telegram, a
  `kill -9` resume, and the kill switch.

## Ren as head (added 2026-11-27, at Kevin's request)

- **Home is Ren HQ.** It shows:
  - Ren's current plan: a headline plus numbered asks, each with its owner desk and live
    status.
  - **Needs you**, one list holding site reviews, Ren's questions (answered inline) and gate
    decisions.
  - The team, with status lights, and today's spend.
  - **Sectors**: Media, Websites, Storefronts and Ren itself. Each has its goals, the current
    number against a target, and a ✓ or ✗. Adapter numbers are tagged MOCK; Ren 2's own
    counts are real.
  - The team channel.
- **Sectors** live in `config/sectors.yaml` (goals, targets, niches, channels, BC areas,
  monetization milestones marked VERIFY).
- **Ren** (`agents/ren.yaml`) runs on four jobs:
  - 07:00 plan: reads the HQ report, then delegates 3–6 concrete asks.
  - Hourly check-in: Worklane sign-ups go to Sites at high priority, and stuck work gets
    unstuck.
  - 19:45 evening review: what moved in each sector today.
  - Monday weekly strategy.

  Ren may move budget between agents (it can only shift money, never add it) and pause or
  resume agents. Ren proposes new agents as questions; it never creates them. Without a
  planning model, Ren falls back to a rule-based plan.
- **Desks by sector:**
  - **Media (Showrunner).** Cadence set by Kevin: a long-form video every day or so, plus a
    few Shorts/Reels daily.
    - 10:00 long-form: a YouTube video of about 6–12 minutes, a thumbnail, and 2 clips cut
      for Shorts/Reels/TikTok.
    - 13:00 and 18:00: native shorts. That makes about 4 shorts a day.
    - Posting asks you separately for long-form and for shorts (`video:publish:long` and
      `video:publish:short`), so shorts can be always-allowed on their own.
    - Scoreboard targets: 5 long-form and 21 shorts a week.
    - Monday analytics: what's working and the distance to monetization. The lesson goes
      to Ren.
  - **Scout.** Sweeps the next BC area each weekday (rotation set in sectors.yaml), rates and
    shortlists the candidates, saves them to memory, and tells Ren.
  - **Sites.** Worklane sign-ups first. Otherwise it builds Ren-approved demos for
    candidates, and only when the system is idle. Every finished site goes to Ren for review.
  - **Ren review → Kevin.** Ren writes Good / Change / Add notes and puts the site in Needs
    you. Your verdict is saved to memory as a decision. "Needs changes" sends the site back
    to Sites at high priority. "Approve" hands it to Outreach. Either way, Ren then rewrites
    `web-design-general` and creates or updates `web-niche-<niche>` skills from all our
    decisions.
  - **Outreach.** Sends the demo email through Builder (the contact gate asks you first).
    The Automation Pro trades batch through Growth Engine is kept.
  - **Storefront Analyst.** Mon/Thu: every property (Worklane, book site, shop), the biggest
    leak on each and the smallest fix. Wednesday: Amazon resale and dropshipping research.
- **Chat goes to Ren.** Ren answers you, or delegates. When a delegated task finishes, its
  result comes back into the chat (and to Telegram).
- **Live run (Claude CLI):**
  - Ren's plan delegated 6 asks.
  - Scout swept an area, the Analyst covered all three properties, and Media ran its
    analytics.
  - Sites built the Refill Pack page, Ren reviewed it, and the review is waiting for Kevin.
  - Ren asked for the niches.
- **Tests:** 60 pass, and the smoke test passes.

## Work desks (added 2026-11-27, at Kevin's request)

- **Desks page** (`#agents`, labelled "Desks"): one card per agent. Each shows a status lamp
  (working, waiting on you, idle, paused), what it's working on right now with step
  progress, inbox count, decisions waiting on you, jobs, today's spend, its last output, and
  chips for its project access and skills. Below the cards is the **Team channel**: every
  request, FYI and reply between agents.
- **Full desk** (`#agents/<id>`) shows:
  - what it's on now and what's next;
  - a "Give it work" box that puts a request in its inbox;
  - its inbox and sent messages, and its recent output;
  - its jobs, each with **Run now**;
  - its project access, tools and skills (skills can be edited in place);
  - its playbook versions with revert, and its numbers;
  - start, pause and stop buttons, and a config editor.
- **Autonomy:** each agent has **jobs** (`jobs:` in its YAML, with an optional cron) and an
  **inbox**. A work loop runs every 2 s. Any running agent that isn't busy picks up the oldest
  request in its inbox, whether it came from a teammate or from Kevin. Each desk works on one
  thing at a time.
- **Working together:** the `message` tool sends a `request` (it becomes work on the other
  agent's desk) or an `fyi` (to one agent, or to the whole team as `*`). When a request
  finishes, a **reply** with the result goes back to whoever asked, automatically, and Kevin
  also gets it on Telegram. Recent FYIs and replies go into each agent's prompts as "Team
  notes". Out of the box:
  - Research asks Content for posts and posts its findings to the team.
  - Sites posts its preview links to the team.
  - Verified live: Research → Content request → Content works it → reply back to Research.
- **Project access:** `access:` in each YAML maps a project to the methods it may call:
  `read` (all read methods), `*` (everything), or a list of named methods. The adapter tool
  enforces this. `tools:` is also enforced. Every agent always has think, memory, message,
  handoff and notify. This scopes what each agent can reach. It is not an approval tier: the
  four gates are still the only things that ask Kevin.
- **Skills:** `skills/*.md` hold project know-how (Storefront funnel diagnosis, competitor scan,
  social post, video script, landing page, cold email for trades, Pi health). Each agent lists
  the skills it uses, and their text goes into its planning and writing prompts.
- **Tests:** 53 tests pass (7 new in `tests/desks.test.ts`), and the smoke test passes.

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
