# <PROJECT NAME>

Read this file fully before doing any work. Sessions may run on different models
(Claude / DeepSeek / Kimi); assume no memory outside this repo. Work in
commit-sized chunks. Do not expand scope beyond the task you were asked to do.
If a decision here seems wrong, say so in the commit message — don't silently
redesign.

## Secrets / API keys — NEVER stop and wait for a key

Missing credentials must not halt the build. When a task needs an API key:

1. Add the variable to `.env.example` (committed, blank/dummy) AND `.env`
   (gitignored, blank if you don't have it).
2. Read it through the guard: `from secrets_guard import need, have`
   `key = need("SOME_KEY", "what it's for", "where-to-get-it.com")`.
3. If the key is absent, `need()` logs it to `SECRETS_NEEDED.md` and returns
   None. Build and commit everything that does NOT require the key's runtime
   value. Stub or skip ONLY the specific calls that need the live key, marking
   each `# BLOCKED: needs <KEY>`.
4. Stop ONLY if the very next required step cannot run without the live key —
   and even then, finish all other reachable work and commit first.
5. If you need the key during the build itself (e.g. to learn an API's real
   response shape), build against a saved sample or the documented schema,
   mark it `# VERIFY against live response`, and note it in SECRETS_NEEDED.md.
6. Non-Python project? Replicate secrets_guard's behaviour in the project's
   language: read env, log missing keys to SECRETS_NEEDED.md, return
   null instead of raising.

The user fills `.env` on their own schedule; the code and the checklist are
waiting for them, not the other way around.

## Working rules

- One task per session/commit. Small, cleanly-diffable changes.
- Never invent API field names: fetch real JSON or leave a `# VERIFY` marker.
- Keep secrets in env vars only. Never commit `.env`.
- Note disagreements in commit messages instead of redesigning.

## Project spec

<Describe the project here: what it is, architecture, decisions already made,
and anything a fresh model must not re-litigate.>

## Status

<Current state. What's built, what's verified, what's next.>
