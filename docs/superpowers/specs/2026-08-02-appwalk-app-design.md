# appwalk app — a packaged desktop app that walks non-developers through their own code

**Date:** 2026-08-02 · **Status:** approved in design conversation (Kevin), spec for the build

## Goal

A **paid desktop app** that lets non-developers point at any app on their machine and finally understand it. Same engine as the free CLI (it drives the CLI as a subprocess — the clean "Fork B": closed UI, open engine). The free CLI stays the public AGPL gift + research tool; the app is the paid front door. Also a **research tool** for Kevin: point it at anything, get its map.

## Decisions locked in the conversation

1. **Form: packaged desktop app (Electron).** Cross-platform `.exe`/`.dmg`/`.AppImage`. Local — nothing leaves the machine. Privacy-forward, drives the CLI directly.
2. **Core UX: interactive map + file-tree explorer, with a guided visual walkthrough as a mode.** Explore-first (tap a node/file → plain explanation); the tour is the guided option.
3. **Architecture: Approach A — the app spawns the CLI as a subprocess and reads structured JSON.** The CLI gains machine-readable modes. The app never imports the CLI's source, so the app's own code stays closed (AGPL-clean).
4. **Pricing: one-time buys the CURRENT version forever; subscriptions ride the UPDATED version.** Sold via the site's existing Stripe checkout.
5. **MVP: the core explorer with NO backend** — map, tree explorer, explain, risks, tour, glossary — all local, no accounts, no AI key. Hosted-AI and report-export come later.
6. **Warm-CRT identity** (amber on warm black, Space Mono + Karla) carries over from the site.

## The app's screens (the non-developer experience)

| Screen | What it is |
|---|---|
| **Open** | "Open a project" — folder picker + drag-and-drop + recent projects. No accounts, no upload. |
| **Overview** | "Here's your app" — project name, what kind (Node/Python/static), where it starts, and the two doors: **Explore the map** (primary) / **Take the guided tour**. The `.js` = JavaScript moment can happen here. |
| **Map view** (primary) | The flow map as a **clickable visual**: nodes + arrows, entry glowing, tap a node → plain explanation panel beside it. Collapsible file-tree sidebar (green ● = entry, with the legend). |
| **File explain** | Tap any file → what it does, why it matters, glossary links, "risky" badge if the audit flags it. |
| **Risks** | The audit findings humanized — what's wrong, why it matters, how to fix — grouped by severity. |
| **Tour mode** | The guided walkthrough, one concept at a time — the patient senior dev, visual. |
| **Glossary** | Every word, searchable. |
| **Settings** | Version, edition, and the subscriber hint: "you're on the current version — subscribers get every update." |

## Architecture

**Electron, three clean layers:**

- **`main` process** — owns the folder picker, spawns the CLI as a subprocess, runs with Node/file access. Hardened: `contextIsolation: true`, `sandbox: true`, no `nodeIntegration` in the renderer.
- **`preload`** — a thin, typed bridge: `window.appwalk.run(folder) → { map, flow, findings, stack, glossary }` and `window.appwalk.explain(file) → { explanation, role, glossary }`.
- **`renderer`** — the warm-CRT UI, plain HTML/CSS/JS (zero-dep, like the site — no framework). Renders map/tree/explain/risks/tour/glossary from the bridge's data.

**Security:** the renderer is sandboxed; no remote code; the CLI runs only against the user-chosen folder; nothing leaves the machine (no telemetry, no phone-home for the one-time edition).

### The CLI bridge (the piece that makes it work — and grows the free tool)

The CLI gains **JSON output modes**, additive to its terminal behavior:

| Mode | The app gets |
|---|---|
| `appwalk tree --json` | the file map with roles + entry markers |
| `appwalk flow --json` | the flow graph (nodes/edges/roles/start) |
| `appwalk audit --json` | findings (already exists) |
| `appwalk explain <file> --json` | a file's plain-language explanation |
| `appwalk stack --json` | what kind of app + where it starts |
| `appwalk glossary --json` | the terms |

The app spawns the CLI, reads JSON, renders. The CLI stays terminal-first; these modes make it scriptable (a gift upgrade). The app bundles the CLI binary in its resources (AGPL, source public — clean to distribute).

## Packaging & delivery

- **electron-builder** produces **Windows `.exe` + Linux `.AppImage`** from the Pi. **Mac `.dmg` is deferred** — you can't reliably build/sign/notarize a Mac app from a Raspberry Pi; it needs a Mac or a CI service (GitHub Actions can build + sign all three) later.
- The app is **self-contained and offline-capable** (bundled CLI, local analysis).
- Versioned releases: the "current version" one-time buyers own.

## Monetization mechanics

- **One-time** — buys the current version forever. A new storefront catalog product (`appwalk-app`); the site checkout delivers the **installer link + a license key**.
- **Subscription** — rides every updated version. Stripe recurring; subscribers get the new installers.
- **License keys:**
  - **One-time keys validate fully OFFLINE** — a signed (HMAC) key encoding the purchased version + edition. Privacy-forward, no phone-home.
  - **Subscription keys need a lightweight online check** (renewal/revocation) — a small license endpoint added when subscriptions launch. **Not in the MVP.**
- The warm-CRT site remains the storefront; the app is a new product on it.

## Build order / MVP

1. **CLI JSON modes** — the bridge the app consumes (pure, tested, keeps the CLI terminal-first).
2. **MVP app** — Electron + warm-CRT renderer: Open → Overview → Map + tree explorer + explain + risks + tour + glossary. Local, offline, no accounts.
3. **Package + sell the one-time** — electron-builder installers (Windows + Linux), the storefront catalog product, offline license keys.
4. **Later** — subscription licensing + the update channel, Mac builds, hosted-AI explanations, report export.

## Out of scope (this spec)

- Hosted-AI explanations, report export, accounts/sync, the hosted web version — later layers.
- The site's Web Pro card already teases the subscription; the app's release should update it.
- The app's own repo/branding name — appwalk, unless Kevin renames the product.
