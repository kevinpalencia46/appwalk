"""
secrets_guard.py — never let a missing API key stop the build.

Usage in any project:
    from secrets_guard import need
    key = need("ST_API_KEY", "Solana Tracker market/holder data", "solanatracker.io")
    if key is None:
        pass  # skip/stub only the calls that actually need the live key

Behaviour:
- Returns the key value if present in the environment (loaded from .env).
- If absent: logs it to SECRETS_NEEDED.md (a human-readable checklist) and
  returns None, so the rest of the program keeps running.
- Never raises, never blocks. The only thing that stops is code that truly
  needs the live value at runtime — and that's on the caller to guard.

Optional strict mode: need(..., required_now=True) raises if you genuinely
cannot proceed, so a build can fail loudly at exactly the blocking step.
"""

import os

MISSING_LOG = "SECRETS_NEEDED.md"
_HEADER = "# Secrets needed\n\nFill these into `.env` when ready. Unchecked = still missing.\n\n"


def _dotenv_load(path=".env"):
    """Minimal .env loader (no dependency). Ignores comments/blank lines."""
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _record(key, purpose, url):
    existing = open(MISSING_LOG).read() if os.path.exists(MISSING_LOG) else _HEADER
    if f"`{key}`" in existing:
        return
    entry = f"- [ ] `{key}` — {purpose}" + (f" — get at {url}" if url else "") + "\n"
    open(MISSING_LOG, "w").write(existing + entry)


_dotenv_load()  # load .env once on import


def need(key, purpose="", url="", required_now=False):
    val = os.getenv(key)
    if val and val not in ("", "CHANGEME", "YOUR_KEY_HERE"):
        return val
    _record(key, purpose, url)
    if required_now:
        raise RuntimeError(
            f"BLOCKED: {key} is required to proceed. Add it to .env. "
            f"({purpose}{'; ' + url if url else ''})"
        )
    return None


def have(key):
    """True if a usable key is present. Cheap gate for optional features."""
    v = os.getenv(key)
    return bool(v) and v not in ("", "CHANGEME", "YOUR_KEY_HERE")
