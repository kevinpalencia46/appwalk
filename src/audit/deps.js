// src/audit/deps.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSafe } from '../util.js';
import { join } from 'node:path';
const exec = promisify(execFile);

export async function scanDeps(map) {
  const out = [];
  const pkg = map.flat.find((n) => n.name === 'package.json');
  if (pkg) {
    if (!map.flat.some((n) => /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb/.test(n.name)))
      out.push({ file: 'package.json', kind: 'missing_lockfile', reason: 'no lockfile — installs are not reproducible' });
    let raw;
    try {
      raw = JSON.parse(await readFileSafe(pkg.path) || '{}');
    } catch {
      out.push({ file: 'package.json', kind: 'malformed_package_json', reason: 'package.json is not valid JSON — fix it before dependency checks' });
      return out;
    }
    const deps = Object.keys(raw.dependencies || {});
    for (const d of deps) {
      // best-effort import scan: a dep is "used" if any source file imports it
      const re = new RegExp(`from ['"]${d}['"]|require\\(['"]${d}['"]\\)`);
      const hit = await Promise.all(map.flat.map(async (n) => {
        if (!/\.(js|jsx|ts|tsx)$/.test(n.name)) return false;
        const t = await readFileSafe(n.path);
        return !!t && re.test(t);
      }));
      if (!hit.some(Boolean)) out.push({ file: `package.json → ${d}`, kind: 'unused_dep', reason: `${d} is declared but I couldn't find an import — candidate to remove` });
    }
  }
  return out;
}
