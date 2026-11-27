# Ren 2

A small, autonomous operating core for Kevin's projects. One process runs teams of agents
(Ops, Research, Content, Sites, Outreach), with one SQLite database and one iPad
dashboard. Kevin makes the decisions that matter from Telegram or the dashboard. Only four
kinds of action ask first: spending money, publishing, contacting people, and deleting
outside Ren 2's own space.

The source of truth is `docs/BRIEF.md`. For what works now, see `STATUS.md`.

## Run it

```bash
cd ren2
npm install
cp .env.example .env      # fill what you have; everything else degrades honestly
npm run build
npm start                 # http://127.0.0.1:8700
```

Talk to it from the dashboard's Home page, or from Telegram once the bot token and chat id
are set. Try: _"summarize what's in memory about Storefront"_.

## Check it

```bash
npm test        # node:test: every module + every endpoint (fake models, fake Telegram)
npm run smoke   # real process: M1 demo, kill -9 restart-resume, kill switch
```

## Layout

```
src/        server, core, router/, tasks/, tools/, adapters/, agents/, telegram/, memory/, gate/
public/     dashboard (static HTML/CSS/JS, no build step)
agents/     one YAML per agent (mission, tools, models, schedule, budget, auto list)
config/     models.yaml (routing), read_paths.yaml, http_hosts.yaml, mcp.yaml
knowledge/  editable markdown notes (indexed into SQLite)
fixtures/   MOCK data for adapters until live routes are mapped
scripts/    smoke, import-knowledge, backup, install-pi.sh
tests/      node:test suites
```

## Pi

`bash scripts/install-pi.sh`. See `docs/DEPLOY_PI.md`.
