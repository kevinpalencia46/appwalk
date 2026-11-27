# Ren 2 — Build Brief for Claude Code

_(Saved verbatim from Kevin's message, 2026-11-27. This is the source of truth.)_

You are building **Ren 2**, a new, small, autonomous operating core for Kevin's projects.
Build it in this cloud environment first. It must move to a Raspberry Pi later with no rewrite.
Read this whole brief before writing code. This brief is the source of truth. If it conflicts
with anything in the old Ren repo, this brief wins.

---

## 1. What Ren 2 is

A single service that runs teams of agents (research, content, sites, outreach, ops) across
Kevin's existing projects. They work continuously and get better over time. Kevin makes the
decisions that matter from **Telegram** or a **dashboard on his iPad**.

The goal is useful work that compounds. It is not meant to show off governance. Every
feature must do something real.

**Kevin's working style:** he wants agents to run end to end and then review the outcome.
Don't stop to ask him about routine choices. Batch real questions into one list.

## 2. Hard rules (read twice)

1. **Small first.** One process, one database, one dashboard. No microservices. No plugin
   frameworks. Don't add an abstraction layer until a second real use needs it.
2. **No governance theatre.** No expiring grants, no permission tiers, no charters, and no
   "designed but not active" agents. The only gates are the four in §5.
3. **Honest data only.** A disconnected service shows as disconnected. Never put
   placeholder numbers or fake success states in the UI. A button that can't do its job
   doesn't ship.
4. **Don't touch the old Ren or the side projects.** Ren 2 connects to them over HTTP
   through adapters (§8). Never edit their repos, databases, configs or services. The
   old Ren keeps running in parallel until Ren 2 replaces it.
5. **Paper-only trading.** Ren 2 may read Trading OS and Meme Scanner. It never places,
   queues or enables real trades.
6. **One status file.** Keep `STATUS.md` current: what works, what's stubbed, what's
   blocked, and what's next. Don't write per-phase reports or audit documents.
7. **Pi-portable from day one.** It must run on ARM64 (Debian 13). Avoid x86-only
   binaries, avoid native modules that are hard to build, and keep memory use low. Plan
   for **≤ 1 GB RAM** for this service.
8. **Secrets** go in `.env` only (gitignored), with a committed `.env.example`. Never
   put secrets in code, logs, Telegram messages or the UI.

## 3. Stack (decided; don't re-debate)

- **Runtime:** Node.js 22+ with TypeScript, compiled with `tsc`. Avoid heavy bundlers.
- **Database:** SQLite via built-in `node:sqlite`. This means no native build step on
  the Pi. Use FTS5 for search.
- **HTTP:** one small server (Fastify or plain `node:http`). It serves the API, the
  dashboard and a server-sent-events (SSE) stream for live updates.
- **Dashboard:** static HTML, CSS and vanilla JS (Preact via ESM is fine if needed). No
  build step for the UI. Design for iPad first.
- **Telegram:** Bot API over HTTPS, using long polling. Webhooks aren't needed.
- **Tests:** `node:test`. Write targeted tests for each module, plus one end-to-end smoke
  script.
- **Process on the Pi:** a systemd user unit with `MemoryMax=` and `Restart=on-failure`.

## 4. Core architecture

```
            Telegram  ◄──►  ┌──────────────── Ren 2 (one process) ────────────────┐
                            │  Chat/Planner ─► Task Queue ─► Runner ─► Verify      │
   iPad dashboard ◄─SSE──►  │       │             │           │                    │
                            │   Model Router   Scheduler    Tools (shell, files,   │
                            │       │             │          http, claude-code,    │
                            │   Memory (SQLite + FTS + notes)   MCP client)        │
                            │       │                         │                    │
                            │   Agents (config files)     Gate (4 rules) + Budget  │
                            └───────────────────┬──────────────────────────────────┘
                                                │ HTTP adapters
              Builder · Storefront · Showrunner · Growth Engine · Meme · Trading (read)
```

### 4.1 Model router
- Providers: **Anthropic (Claude)**, **DeepSeek**, **Ollama (local)**, **Claude Code CLI
  (headless)**, and optionally **Kimi**. TTS uses **Piper** (local) and **ElevenLabs** (optional).
- Routing is a single config file, `config/models.yaml`. Each task kind
  (chat, plan, code, research, cheap-summarize, embed) maps to an ordered list of
  models, with a fallback when a provider is down or unconfigured.
- Use cheap or local models for summaries and classification. Use strong models only for
  planning and writing that will go out to real people.
- **Budget:** log the cost of every call. There's a daily cap (default **$5 USD/day**,
  configurable) and a per-agent cap. At 80% of the cap, send a Telegram warning. At 100%,
  pause cloud calls until midnight or until Kevin raises the cap from Telegram.

### 4.2 Tasks
- Lifecycle: `queued → planning → running → verifying → done | failed | needs_decision`.
- Every task stores its objective, its plan (steps), each step's tool calls and output,
  its cost, its result and a short report.
- **Recovery after a restart:** on boot, tasks that were running resume from their last
  completed step. Steps must be idempotent, or record that they have already run.
- **Duplicate failures:** if the same task signature fails 3 times, open one "recurring
  failure" item with a diagnosis attempt, pause that schedule and notify Kevin once.
  Never spam duplicates.
- Archive done tasks older than 30 days out of the default views. Never delete them.

### 4.3 Tools (Pi-native)
- `shell`: runs commands in `workspace/`. It uses timeouts, output caps and a
  resource-aware concurrency limit (default 1 heavy and 3 light).
- `files`: read and write inside `workspace/` and Ren 2's own repo. It can read the paths
  listed in `config/read_paths.yaml`.
- `http`: outbound requests. Each adapter limits which hosts it talks to.
- `claude_code`: runs headless Claude Code in a git worktree for coding tasks. The result
  is a branch, plus a summary and test output.
- `mcp_client`: connects to MCP servers listed in `config/mcp.yaml`.
- `memory`: search, read and write knowledge (§4.4).
- Each tool reports its own status (`ok`, `needs_config`, `needs_credentials` or
  `unavailable`). The dashboard shows that status honestly.

### 4.4 Memory (one source of truth)
- SQLite tables for knowledge items, each with a project, kind (fact, decision,
  preference, playbook, lesson) and source.
- FTS5 search now. Optional embeddings via Ollama `nomic-embed-text` later, behind a flag.
- `knowledge/` holds markdown notes that Kevin can edit. They're indexed into the database
  on change. Markdown is the human-editable copy; the database is the index.
- **Import once:** copy the old Ren knowledge folder and project docs in read-only
  (path set in `.env`). Write a one-time import script; don't sync continuously.
- Before planning, the planner pulls the top relevant items for the objective and the
  project. Keep that context small.

### 4.5 Agents
Agents are **config files** in `agents/<id>.yaml`. There's no agent registry bureaucracy.

```yaml
id: research
name: Research
mission: Find what Kevin's target customers want and what competitors do; feed findings to other agents.
projects: [storefront, builder, showrunner, appliance-pro-site]
tools: [http, memory, mcp_client]
models: { plan: claude, work: deepseek, summarize: ollama }
schedule: "0 6 * * *"        # cron
daily_budget_usd: 1.00
reports_to: telegram_digest   # or telegram_now
auto: []                      # action types Kevin has promoted from "ask" to "auto" (§5)
```

- Controls for each agent: **start, pause and stop**, from the dashboard and from Telegram
  (`/pause research`).
- Each agent has a **playbook** (memory kind `playbook`): its own current best practices.
- **Getting better:** once a week, each agent runs a retro. It reviews its last week of
  results against its metrics (approvals vs. rejections, engagement, replies, visits,
  conversions where available). Then it proposes edits to its playbook. Playbook edits
  are auto-applied, versioned and revertible with one click. The weekly Telegram digest
  shows what changed and why.
- Agents can hand work to each other by creating tasks. Research findings go to Content
  and Outreach, Content drafts go to the publishing queue, and so on.

## 5. The only four gates

Everything else runs without asking. These four actions create a **decision** that goes
to Telegram (inline buttons) and the dashboard:

| Gate | Examples |
|---|---|
| **Money** | any purchase, subscription, ad spend, paid API beyond the budget cap |
| **Publish** | posting to social, deploying a site to a public URL, sending a newsletter |
| **Contact people** | outreach emails or DMs, replies to real customers or prospects |
| **Destroy** | deleting or overwriting anything outside `workspace/` and Ren 2's own repo |

- Telegram decision message: a short summary, a preview (text, image or link) and the
  buttons **Approve · Edit · Reject · Always allow this**.
  - **Edit** lets Kevin reply with changes. The agent revises and asks again.
  - **Always allow this** adds that action type, for that agent, to its `auto` list (for
    example, "Content may post to X without asking"). That's how autonomy grows. Show
    and revert these from Settings.
- Decisions never expire into an approval. A decision with no answer stays pending. After
  48h it moves to a "stale" list with one reminder.
- **Kill switch:** `/stop` in Telegram or the big button on the dashboard. It halts all
  agents and in-flight tasks immediately. `/resume` restarts them. Test this.

## 6. Telegram

- One bot, chat-locked to Kevin's chat ID. Ignore every other chat.
- **Talk to Ren:** free-text messages go to the planner, just like dashboard chat.
- **Notifications:** decisions (immediate), failures that need Kevin (immediate), and a
  daily digest (once a day): what each agent did, results, money spent, and what's next.
- **Commands:** `/status`, `/agents`, `/pause <agent>`, `/resume <agent>`, `/stop`,
  `/resume`, `/budget`, `/decisions`, `/new <objective>`.
- Keep messages short and easy to scan on a phone. Link to the dashboard for detail.

## 7. Dashboard (6 pages, no more)

Keep the feel of the old Ren "Fleet" Home: graphite console, a living orb in the centre,
and route colours (cool `#6FE3C4` local, warm `#F4C87A` Claude cloud, purple `#A78BFA`
Claude CLI). Kevin can point you to the old CSS. Usability beats decoration. Make every
control large enough to tap on an iPad.

1. **Home:** Ren status, chat with Ren, current work, pending decisions (with buttons),
   alerts, today's spend, recent results.
2. **Work:** tasks filtered by state. Each task opens to show its plan, steps, output,
   cost and report. Failed and recurring-failure items have retry and dismiss buttons.
3. **Agents:** cards with mission, status, last run, results, playbook and budget.
   Start, pause, stop, edit config, plus a create-agent form.
4. **Projects:** each connected project with its adapter status, key numbers (honest),
   assigned agents and knowledge.
5. **Memory:** search, browse by project and kind, edit notes, recent decisions.
6. **System:** Pi health (CPU, RAM, swap, temperature, disk), models and their status,
   tools and their status, budget settings, the "always allow" list, the kill switch.

Every button calls a real endpoint. Each endpoint has a test.

## 8. Project adapters (connect, don't merge)

Each adapter is one file in `src/adapters/`. It has a `status()`, typed read methods, and
action methods (actions that hit a §5 gate go through the gate). Base URLs and tokens come
from `.env`. **In this cloud build the Pi services aren't reachable.** So every adapter has
a **mock mode** that uses fixture data marked clearly as MOCK in the UI. On the Pi, the
same adapter switches to live mode through config.

| Project | Pi address | Ren 2 uses it for | Access |
|---|---|---|---|
| Builder | `127.0.0.1:8400` | spin up product and client sites, previews | read + create (publish is gated) |
| Storefront | `127.0.0.1:8200` | products, visits, checkout starts, orders | read + create candidate products (go-live is gated) |
| Showrunner | `127.0.0.1:8300` | script → voice → render content jobs | read + queue jobs (publish is gated) |
| Growth Engine (BGE) | `127.0.0.1:8601` | leads, CRM, outreach drafts | read + draft (send is gated) |
| Meme Scanner | `127.0.0.1:8500` | signal summaries | **read only** |
| Trading OS | `127.0.0.1:8000` | paper results | **read only** |
| Old Ren | `127.0.0.1:8100` + Ren MCP | knowledge import, status | **read only** |

Before writing each live adapter, ask Kevin for (or read, if given access to) that
service's actual API routes. **Don't invent endpoints.** Until then, build against the
mock with an interface you can adjust.

**Social publishing:** a `publisher` interface with one adapter per platform. Start with
drafts-only plus one platform Kevin picks. Mark the others `needs_credentials` until he
provides access. Everything goes through the Publish gate unless that agent is on the
`auto` list.

## 9. Starting agent lineup

Build these in this order. An agent counts as done only when it has produced a real
result end to end, not when its config exists.

1. **Ops:** watches Pi health, Ren 2 itself and adapter status. Fixes Ren 2's own problems
   (restarts its own workers, clears its own queue jams). Reports recurring failures.
   On the Pi, it may observe the side projects' service status but never restart them.
2. **Research:** a daily market and competitor scan for the active projects. It writes
   findings to memory and creates tasks for other agents. First focus: why Storefront has
   about 1,000 visits and 0 orders. It analyses the offer, pages, pricing and traffic
   sources, and proposes concrete changes.
3. **Content:** turns research into posts, scripts and Showrunner jobs. Drafts go to the
   Publish gate.
4. **Sites:** uses Builder to spin up a landing page for a product or offer on request
   ("make a site for X"). The preview link goes to Telegram. Going live is gated.
5. **Outreach:** finds prospects (local businesses that fit Automation Pro and the trades
   offers) and drafts personalized messages into the Growth Engine (BGE). Sending is gated.

## 10. Milestones (don't stop between them for approval)

- **M1 – Core:** server, database, model router with budget, memory, tasks with
  restart-resume, tools, Telegram (chat, commands, decisions, kill switch), dashboard
  Home + Work + System.
  *Demo:* Kevin messages "summarize what's in memory about Storefront" on Telegram. A task
  runs, he sees it live on the dashboard, gets the answer, and it shows as done. Restart
  the process mid-task and it resumes.
- **M2 – Agents:** agent configs, scheduler, Agents page, Ops + Research live,
  the weekly retro and playbook loop, daily digest.
- **M3 – Projects:** adapters (mock now), Projects + Memory pages, Content + Sites agents,
  the knowledge import script.
- **M4 – Outreach + publishing:** Outreach agent, publisher interface, "always allow".
- **M5 – Pi deploy:** `scripts/install-pi.sh` (checks Node version and ARM64, creates the
  systemd unit with limits, copies `.env.example`, runs migrations and the smoke test),
  `docs/DEPLOY_PI.md`, plus a backup script (database plus `knowledge/` to a dated
  tarball, keeping the last 14). The dashboard is reachable only over Tailscale, with an
  owner token login.

After each milestone: run the targeted tests and the smoke script, update `STATUS.md`,
commit, and continue. Collect anything that needs Kevin (API keys, a Telegram bot token,
API routes, platform choice) into one **"Needs Kevin"** list at the top of `STATUS.md` and
keep going on everything else.

## 11. Repo layout

```
ren2/
  src/ (server, router, tasks, tools/, adapters/, agents/, telegram/, memory/, gate/)
  public/ (dashboard)
  agents/*.yaml   config/*.yaml   knowledge/   workspace/ (gitignored)
  scripts/ (import-knowledge, install-pi, backup, smoke)
  tests/   STATUS.md   README.md   .env.example
```

## 12. First actions

1. Write `STATUS.md` with a short plan, check it against this brief, and put the "Needs
   Kevin" list at the top.
2. Scaffold the repo and get the server, database and a health page running.
3. Build M1 end to end and run its demo.
4. Continue through M2–M4. Prepare M5 so the Pi move is a single script.

Begin.
