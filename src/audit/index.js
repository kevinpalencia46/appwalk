// src/audit/index.js — the single all-findings aggregation, shared by the CLI
// (bin/appwalk.js) and the shell (src/tui/app.js) so the pipeline can't drift.
import { scanSecrets } from './secrets.js';
import { scanDuplicates } from './duplicates.js';
import { scanClutter } from './clutter.js';
import { scanDeps } from './deps.js';
import { scanGit } from './githygiene.js';

export const allFindings = async (root, map) => (await Promise.all([
  scanSecrets(map), scanDuplicates(map), scanClutter(map), scanDeps(map), scanGit(root, map),
])).flat();
