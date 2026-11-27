# Deploy Ren 2 to the Raspberry Pi

The target is ARM64 Debian 13 (Raspberry Pi OS), and Ren 2 gets at most 1 GB of RAM. Nothing
needs compiling: SQLite is built into Node, and the only runtime dependency (`yaml`) is pure
JavaScript.

## 1. Prerequisites (once)

```bash
# Node 22.5+ (22.13+ recommended). The official arm64 build works without compiling.
node -v
# Tailscale, so the dashboard is only reachable on your tailnet
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
# Optional but recommended: local models for free summaries
curl -fsSL https://ollama.com/install.sh | sh && ollama pull llama3.2:3b
# Optional: Claude Code CLI (headless coding + fallback model), logged in as you
```

## 2. Install

```bash
git clone <appwalk repo> && cd appwalk/ren2
bash scripts/install-pi.sh
sudo loginctl enable-linger $USER     # keep running after logout
```

The installer:

1. Checks for ARM64 and Node ≥ 22.5 with `node:sqlite`.
2. Runs `npm ci` and builds with `tsc`.
3. Creates `.env` from `.env.example` with a fresh `REN2_OWNER_TOKEN`. If Tailscale is
   installed, it binds the dashboard to the Tailscale IP.
4. Runs migrations and the smoke test.
5. Writes and enables `~/.config/systemd/user/ren2.service` (`MemoryMax=1G`,
   `MemoryHigh=800M`, `Restart=on-failure`, `--max-old-space-size=384`) and a daily
   `ren2-backup.timer` at 03:17.

It's safe to re-run: an existing `.env` is never overwritten.

## 3. Configure

Edit `.env` (it's `chmod 600`):

- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Add any model keys you have.
- Set `REN2_ADAPTER_MODE=live` only after the side projects' API routes are mapped (see
  `STATUS.md`).

Then restart and watch the logs:

```bash
systemctl --user restart ren2
journalctl --user -u ren2 -f
```

To open the dashboard, browse to `http://<tailscale-ip>:8700` and sign in with the owner token.
On the iPad, use Share → Add to Home Screen.

## 4. Backups

`node dist/scripts/backup.js` writes `backups/ren2-YYYYmmdd-HHMMSS.tar.gz`, which contains a
consistent database snapshot (`VACUUM INTO`) plus `knowledge/`. It keeps the newest 14.

To restore:

```bash
systemctl --user stop ren2
tar -xzf backups/ren2-<stamp>.tar.gz -C /tmp/r && cp /tmp/r/ren2.db data/ren2.db && cp -r /tmp/r/knowledge/. knowledge/
systemctl --user start ren2
```

## 5. Update

```bash
git pull && npm ci && npm run build && npm run migrate && systemctl --user restart ren2
```

## Running beside the old Ren

Ren 2 listens on 8700 and never touches the old Ren's repo, database, config or service. It
only reads the old Ren over HTTP (adapter, port 8100) and imports its knowledge once
(`npm run import-knowledge`).
