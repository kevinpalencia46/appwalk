# ren2/ — Ren 2 (separate from appwalk)

This folder is **Ren 2**, Kevin's autonomous operating core. It shares the appwalk repo only as
a home ("use appwalk, keep it separate"). The appwalk rules in `../CLAUDE.md` don't apply here,
and nothing in `ren2/` should touch appwalk code.

- **Source of truth:** `docs/BRIEF.md`. It wins over anything else.
- **Single status file:** `STATUS.md`, with the "Needs Kevin" list at the top. Don't write
  per-phase reports or audit documents.
- **Hard rules:** small first, no governance theatre, honest data only (MOCK is labelled),
  never touch the old Ren or side projects (HTTP adapters only), paper-only trading,
  Pi-portable (ARM64, ≤1 GB), secrets only in `.env`.
- **Never invent API routes or response fields.** Leave a `VERIFY` marker instead.
- **Checks:** `npm test` (node:test) and `npm run smoke` both pass before every commit.
