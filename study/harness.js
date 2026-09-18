// Clone → audit → record → delete, one repo at a time.
//
// A run over hundreds of network clones WILL be interrupted. Every repo gets a
// record whatever happens, so a restart skips finished work and failures appear
// in the published method as sample attrition rather than silently shrinking the
// denominator.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, appendFile, rm, mkdir, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const run = promisify(execFile);

const CLONES = process.env.STUDY_CLONES || 'study/clones';
const OUT = process.env.STUDY_FINDINGS || 'study/findings.jsonl';
const CORPUS = process.env.STUDY_CORPUS || 'study/corpus.jsonl';
const MIN_FREE_GB = Number(process.env.STUDY_MIN_FREE_GB || 5);
const MAX_KB = Number(process.env.STUDY_MAX_KB || 200_000); // skip >200 MB repos

const APPWALK = process.env.STUDY_APPWALK || process.cwd();

// A silent misconfiguration here destroys the whole study: the first pilot run
// scanned appwalk's own repo 50 times, because the CLI ignores a path argument
// and audits process.cwd(). The tell was arithmetic — every kind came back an
// exact multiple of 50. Never let that pass quietly again.
//
// Only absolute paths are checkable. `file` also carries a '.env' sentinel from
// env_in_git and labels like 'package.json → zod' from the deps checker; those
// are descriptions, not locations, and validating them would reject every repo.
export function assertScannedTheClone(findings, dir, label) {
  const stray = findings.find(
    (f) => typeof f.file === 'string' && f.file.startsWith('/') && !f.file.startsWith(dir),
  );
  if (stray) {
    throw new Error(
      `audit scanned the wrong directory for ${label}: expected files under ${dir}, got ${stray.file}`,
    );
  }
}

export function alreadyDone(records) {
  return new Set(records.map((r) => r.full_name));
}

export function recordFor(repo, outcome, findings) {
  return {
    full_name: repo.full_name,
    stratum: repo.stratum,
    outcome,
    findings: Array.isArray(findings) ? findings : [],
    scanned_at: new Date().toISOString(),
  };
}

async function readJsonl(path) {
  try {
    const t = await readFile(path, 'utf8');
    return t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function main() {
  const { bsize, bavail } = await statfs('.');
  const freeGb = (bsize * bavail) / 1e9;
  if (freeGb < MIN_FREE_GB) {
    throw new Error(`only ${freeGb.toFixed(1)} GB free; need ${MIN_FREE_GB} before starting`);
  }

  const corpus = await readJsonl(CORPUS);
  const done = alreadyDone(await readJsonl(OUT));
  await mkdir(CLONES, { recursive: true });

  let n = 0;
  for (const repo of corpus) {
    if (done.has(repo.full_name)) continue;
    n++;
    // Absolute: the child reports absolute paths, so the guard compares like with like.
    const dir = resolve(join(CLONES, repo.full_name.replace(/\//g, '__')));
    let outcome = 'ok';
    let findings = [];

    if (repo.size_kb && repo.size_kb > MAX_KB) {
      outcome = 'too_large';
    } else {
      try {
        await run('git', ['clone', '--depth', '1', '--single-branch', repo.clone_url, dir], {
          timeout: 120_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        // appwalk audits process.cwd() and takes NO directory argument
        // (bin/appwalk.js: `const root = process.cwd()`). Passing a path is
        // silently ignored, so the target MUST be set as the child's cwd.
        const { stdout } = await run('node', [join(APPWALK, 'bin/appwalk.js'), 'audit', '--json'], {
          cwd: dir,
          timeout: 120_000,
          maxBuffer: 50_000_000,
        });
        findings = JSON.parse(stdout || '[]');
        assertScannedTheClone(findings, dir, repo.full_name);
      } catch (e) {
        // A guard failure is a bug in the study, not a property of the repo.
        // It gets its own outcome so it can never hide inside the attrition count.
        if (/scanned the wrong directory/.test(e.message || '')) {
          outcome = 'guard_failed';
          console.error(`GUARD: ${e.message}`);
        } else {
          outcome = e.killed || /timed out/i.test(e.message || '') ? 'timeout' : 'clone_failed';
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    await appendFile(OUT, JSON.stringify(recordFor(repo, outcome, findings)) + '\n');
    console.log(`[${n}] ${repo.full_name} ${outcome} findings=${findings.length}`);
  }
  console.log(`done: ${n} newly scanned`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
