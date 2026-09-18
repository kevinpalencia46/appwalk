// Clone → audit → record → delete, one repo at a time.
//
// A run over hundreds of network clones WILL be interrupted. Every repo gets a
// record whatever happens, so a restart skips finished work and failures appear
// in the published method as sample attrition rather than silently shrinking the
// denominator.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, appendFile, rm, mkdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);

const CLONES = process.env.STUDY_CLONES || 'study/clones';
const OUT = process.env.STUDY_FINDINGS || 'study/findings.jsonl';
const CORPUS = process.env.STUDY_CORPUS || 'study/corpus.jsonl';
const MIN_FREE_GB = Number(process.env.STUDY_MIN_FREE_GB || 5);
const MAX_KB = Number(process.env.STUDY_MAX_KB || 200_000); // skip >200 MB repos

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
    const dir = join(CLONES, repo.full_name.replace(/\//g, '__'));
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
        const { stdout } = await run('node', ['bin/appwalk.js', 'audit', '--json', dir], {
          timeout: 120_000,
          maxBuffer: 50_000_000,
        });
        findings = JSON.parse(stdout || '[]');
      } catch (e) {
        outcome = e.killed || /timed out/i.test(e.message || '') ? 'timeout' : 'clone_failed';
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
