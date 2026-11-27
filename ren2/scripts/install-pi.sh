#!/usr/bin/env bash
# Ren 2 — one-shot install on a Raspberry Pi (ARM64, Debian 13 / Raspberry Pi OS).
# Checks Node + arch, builds, creates .env from the template, runs migrations and the
# smoke test, installs a systemd *user* unit with memory limits, and a daily backup timer.
# Re-running is safe. Usage:  cd ren2 && bash scripts/install-pi.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REN2_DIR="$(pwd)"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# 1. Platform checks
ARCH="$(uname -m)"
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
  [[ "${REN2_ALLOW_ANY_ARCH:-}" == "1" ]] || die "expected ARM64 (aarch64), got $ARCH. Set REN2_ALLOW_ANY_ARCH=1 to install anyway."
fi
command -v node >/dev/null || die "Node.js not found. Install Node 22+ (e.g. from nodesource or the official arm64 tarball)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 5) )); then die "Node $(node -v) is too old; need 22.5+ for node:sqlite."; fi
node -e "require('node:sqlite')" 2>/dev/null || die "this Node build lacks node:sqlite"
say "Node $(node -v) on $ARCH — ok"

# 2. Build
say "Installing and building"
npm ci --no-audit --no-fund
npm run build

# 3. .env
if [[ ! -f .env ]]; then
  cp .env.example .env
  TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
  sed -i "s|^REN2_OWNER_TOKEN=.*|REN2_OWNER_TOKEN=${TOKEN}|" .env
  sed -i "s|^REN2_ADAPTER_MODE=.*|REN2_ADAPTER_MODE=mock|" .env
  if command -v tailscale >/dev/null && TSIP="$(tailscale ip -4 2>/dev/null | head -1)" && [[ -n "$TSIP" ]]; then
    sed -i "s|^REN2_HOST=.*|REN2_HOST=${TSIP}|" .env
    sed -i "s|^REN2_DASHBOARD_URL=.*|REN2_DASHBOARD_URL=http://${TSIP}:8700|" .env
    say "Dashboard will listen on Tailscale only: http://${TSIP}:8700"
  else
    say "Tailscale not found — dashboard stays on 127.0.0.1. Install Tailscale and set REN2_HOST to its IP."
  fi
  say "Created .env (owner token generated — it's in .env as REN2_OWNER_TOKEN). Fill in API keys + Telegram there."
else
  say ".env exists — leaving it alone"
fi
chmod 600 .env

# 4. Migrations + smoke
say "Running migrations"
npm run migrate
say "Running the smoke test (cloud models off, fake Telegram)"
node --disable-warning=ExperimentalWarning dist/scripts/smoke.js

# 5. systemd user unit (memory-limited, restarts on failure)
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
NODE_BIN="$(command -v node)"
cat > "$UNIT_DIR/ren2.service" <<UNIT
[Unit]
Description=Ren 2 operating core
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REN2_DIR}
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin
ExecStart=${NODE_BIN} --disable-warning=ExperimentalWarning --max-old-space-size=384 ${REN2_DIR}/dist/src/main.js
Restart=on-failure
RestartSec=5
MemoryMax=1G
MemoryHigh=800M
TasksMax=256
Nice=5

[Install]
WantedBy=default.target
UNIT

cat > "$UNIT_DIR/ren2-backup.service" <<UNIT
[Unit]
Description=Ren 2 backup (database + knowledge)

[Service]
Type=oneshot
WorkingDirectory=${REN2_DIR}
ExecStart=${NODE_BIN} --disable-warning=ExperimentalWarning ${REN2_DIR}/dist/scripts/backup.js
UNIT

cat > "$UNIT_DIR/ren2-backup.timer" <<UNIT
[Unit]
Description=Daily Ren 2 backup

[Timer]
OnCalendar=*-*-* 03:17
Persistent=true

[Install]
WantedBy=timers.target
UNIT

if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable --now ren2.service ren2-backup.timer
  say "ren2.service running: systemctl --user status ren2"
  if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
    say "To keep Ren 2 running after you log out: sudo loginctl enable-linger $USER"
  fi
else
  say "systemd user session not available here — units written to $UNIT_DIR; enable them with:"
  echo "    systemctl --user daemon-reload && systemctl --user enable --now ren2.service ren2-backup.timer"
fi
say "Done. Logs: journalctl --user -u ren2 -f"
