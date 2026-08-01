// src/audit/githygiene.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const exec = promisify(execFile);

export async function scanGit(root, map) {
  const out = [];
  try {
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: root, timeout: 8000 });
    for (const line of stdout.split('\n').filter(Boolean)) {
      const rel = line.slice(3);
      if (rel === '.env' || rel.endsWith('/.env')) out.push({ file: rel, kind: 'env_in_git', reason: '.env is tracked by git — secrets are committed' });
      else if (!rel.startsWith('??')) out.push({ file: rel, kind: 'uncommitted', reason: 'modified/uncommitted — changes are not saved to git' });
    }
  } catch { /* not a git repo — skip */ }
  return out;
}
