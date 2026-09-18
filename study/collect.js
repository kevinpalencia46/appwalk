// Pages the GitHub Search API for the Lovable stratum and writes a corpus file.
//
// Search caps at 1000 results per query however many matches exist, so this is a
// sample of what the API will return, not a uniform sample of all 288k matching
// repos. That distinction belongs in the report's method section, not buried here.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { drawSample, writeCorpus } from './corpus.js';

const run = promisify(execFile);

const QUERY = process.env.STUDY_QUERY || '"lovable.dev" in:readme';
const SEED = process.env.STUDY_SEED || 'lovable-2026-09-17';
const SIZE = Number(process.env.STUDY_SIZE || 50);
const OUT = process.env.STUDY_CORPUS || 'study/corpus.jsonl';

async function page(n) {
  const { stdout } = await run(
    'gh',
    ['api', '-X', 'GET', 'search/repositories',
      '--field', `q=${QUERY}`, '--field', 'per_page=100', '--field', `page=${n}`],
    { maxBuffer: 20_000_000 },
  );
  return JSON.parse(stdout).items || [];
}

const seen = new Map();
for (let n = 1; n <= 10; n++) {
  let items;
  try {
    items = await page(n);
  } catch (e) {
    // A rate limit or a 422 past the 1000-result ceiling ends collection; it does
    // not invalidate what we already have. Report it rather than dying silently.
    console.error(`page ${n} failed, stopping: ${e.message.split('\n')[0]}`);
    break;
  }
  if (!items.length) break;
  for (const it of items) {
    if (it.fork) continue; // forks duplicate their parent's findings
    seen.set(it.full_name, {
      full_name: it.full_name,
      clone_url: it.clone_url,
      stars: it.stargazers_count,
      pushed_at: it.pushed_at,
      size_kb: it.size,
      stratum: 'lovable',
    });
  }
  process.stderr.write(`page ${n}: ${seen.size} unique candidates\n`);
  await new Promise((r) => setTimeout(r, 2500)); // stay under 30 searches/min
}

const sample = drawSample([...seen.values()], SIZE, SEED);
const n = await writeCorpus(sample, OUT);
console.log(`candidates=${seen.size} sampled=${n} seed=${SEED} out=${OUT}`);
