// src/audit/index.js — the single all-findings aggregation, shared by the CLI
// (bin/appwalk.js) and the shell (src/tui/app.js) so the pipeline can't drift.
// It also owns the five-category split so the checklist screen, the one-shot CLI
// output, and (later) the report all score the audit the same way.
import { scanSecrets } from './secrets.js';
import { scanDuplicates } from './duplicates.js';
import { scanClutter } from './clutter.js';
import { scanDeps } from './deps.js';
import { scanGit } from './githygiene.js';

export const allFindings = async (root, map) => (await Promise.all([
  scanSecrets(map), scanDuplicates(map), scanClutter(map), scanDeps(map), scanGit(root, map),
])).flat();

// The five audit categories, in the order the checklist shows them (secrets first so
// the critical findings surface before the rest).
export const CATEGORIES = ['secrets', 'duplicates', 'clutter', 'deps', 'git'];

// Fallback kind→category mapping. Every scanner attaches an explicit `category` to its
// findings; this only covers a finding that somehow slips through without one.
const KIND_CAT = {
  stripe_live: 'secrets', aws: 'secrets', github: 'secrets', google: 'secrets', slack: 'secrets',
  private_key: 'secrets', db_url: 'secrets', generic_key: 'secrets',
  duplicate: 'duplicates',
  bak: 'clutter', todo_only: 'clutter', empty_dir: 'clutter',
  missing_lockfile: 'deps', malformed_package_json: 'deps', unused_dep: 'deps',
  env_in_git: 'git', uncommitted: 'git',
};

export const categoryOf = (f) => f.category || KIND_CAT[f.kind] || 'git';

// A category is clean when it has 0 findings; the score is how many are clean.
export const cleanCount = (finds) => CATEGORIES.filter((c) => !finds.some((f) => categoryOf(f) === c)).length;
