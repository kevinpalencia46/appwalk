# Audit study — 50-repo pilot results

**Date:** 2026-09-17
**Corpus:** 50 repos drawn from 1,000 GitHub Search candidates matching
`"lovable.dev" in:readme`, seed `lovable-2026-09-17`, forks excluded.
**Method:** shallow clone → `appwalk audit --json` run with cwd set to the clone
→ record → delete. Guard asserts every absolute finding path lies inside the
clone.

## Run quality

| | |
| --- | --- |
| Scanned | 50 / 50 |
| Attrition | 0 |
| Guard failures | 0 |
| Total findings | 406 |
| Median findings per repo | 5 |

## Findings

| Measure | Result |
| --- | --- |
| Repos with any secrets finding | **19 / 50 (38%)** |
| Repos that committed their `.env` | **14 / 50 (28%)** |
| Repos with a key hardcoded in source | 5 |
| Unused dependencies | 300 (**6.0 per repo**) |
| Duplicate code blocks | 78 |
| **Repos with any test directory** | **0 / 50** |

Secrets by kind (non-fixture): `env_in_git` 14, `google` 5, `generic_key` 2.

## What this does and does not establish

**Zero `supabase_service_role` keys were found in source.** That is consistent
with the known `.env` blind spot rather than evidence of safety: Lovable puts the
Supabase keys in `.env`, `scanSecrets` never reads `.env` values by design, and
28% of these repos committed that file. The service_role exposure most likely
sits inside those 14 committed `.env` files, where we deliberately do not look.
So service_role counts are a **floor, not a total**.

The fixture rate is 0.0% because **no repo in the sample has a test directory at
all** — there were no fixtures to misclassify. That is a finding in its own right,
not a classifier that failed to fire.

Sample-frame caveat: GitHub Search returns at most 1,000 results regardless of the
288,047 matching repos, so this is a sample of what the API returns, not a uniform
sample of the population.

## The first pilot was invalid

An earlier run of this same corpus produced 495 findings, a 66.5% fixture rate and
"100% of repos high severity". Those numbers were an artifact: `bin/appwalk.js`
audits `process.cwd()` and accepts no directory argument, so the path the harness
passed was ignored and appwalk's own repo was audited 50 times. The tell was
arithmetic — every kind came back an exact multiple of 50. Discarded, not
reported. Fixed in `882915d`, with a guard so it cannot recur silently.
