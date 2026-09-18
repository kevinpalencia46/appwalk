# Audit Study Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach appwalk to detect leaked Supabase service-role keys, then build a resumable harness that scans a stratified sample of public Lovable-built repos and produces publishable aggregate findings.

**Architecture:** Task 1 extends the shipped audit engine with the one detector the study cannot run without. Tasks 2–5 build a separate `study/` toolchain that shells out to that engine — the study never reimplements auditing, it drives it. Everything downstream of the scan reads one JSONL findings store, from which two views are derived: a private notification view and a hashed publication view.

**Tech Stack:** Node 20+, ESM, zero runtime dependencies, `node:test`. GitHub Search API via `gh`.

## Global Constraints

- Repo: `/home/ren/appwalk`. **Zero runtime dependencies** — `node:` builtins only. This is a stated project principle; do not add a package.
- Node 20+, ESM. Tests are `node --test`, one test file per module, run with `npm test`.
- The audit core runs with **zero AI**. Nothing in this plan may introduce an AI call or an API key requirement.
- **`.env` is shown as a location, never its values** — in every mode.
- Secret snippets are always masked via the existing `mask()` helper. Never emit a raw credential to disk, stdout, or a report.
- **We never test a discovered credential against its provider.** No network call is ever made with a found key. Severity is pattern confidence only.
- Existing secret kinds, verified in `src/audit/secrets.js`: `aws`, `db_url`, `env_in_git`, `generic_key`, `github`, `google`, `private_key`, `slack`, `stripe_live`. Task 1 adds exactly one more.
- Study strata for the first run: **Lovable only** (`lovable.dev` in README — 288,047 repos as measured 2026-09-17).
- GitHub limits: 5,000 core requests/hour, 30 search requests/minute, authenticated as `kevinpalencia46`.

---

### Task 1: Detect leaked Supabase service-role keys

Supabase keys are JWTs. The `anon` key is **public by design** and ships in every Lovable client bundle legitimately — flagging it would make the tool useless on its own target audience. The `service_role` key bypasses row-level security entirely. A regex cannot tell them apart, because the role lives inside the base64 payload. So the detector matches the JWT shape, decodes the payload, and reports only `service_role`.

Real payload shape, observed 2026-09-17 in a live Lovable app:
`{"iss":"supabase","ref":"bwszfufwvnkgkrhnrztx","role":"anon","iat":1762811494,"exp":2078387494}`

**Files:**
- Modify: `src/audit/secrets.js`
- Create: `test/audit-supabase.test.js`

**Interfaces:**
- Consumes: the existing `mask()` and the `PATTERNS`/`scanSecrets` structure in `src/audit/secrets.js`.
- Produces: a finding with `kind: 'supabase_service_role'`, `category: 'secrets'`, and the standard `{file, line, kind, category, snippet, label, fix}` shape every other detector emits.

- [ ] **Step 1: Write the failing test**

Create `test/audit-supabase.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSupabaseRole } from '../src/audit/secrets.js';

// Build a JWT with the real Supabase payload shape. Signature is irrelevant —
// we never verify it, we only read the role claim.
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;
}

test('reads service_role out of a Supabase JWT', () => {
  const t = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role', iat: 1, exp: 2 });
  assert.equal(decodeSupabaseRole(t), 'service_role');
});

test('reads anon out of a Supabase JWT', () => {
  const t = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon', iat: 1, exp: 2 });
  assert.equal(decodeSupabaseRole(t), 'anon');
});

test('ignores a JWT that is not issued by supabase', () => {
  const t = jwt({ iss: 'auth0', role: 'service_role' });
  assert.equal(decodeSupabaseRole(t), null);
});

test('returns null for malformed base64 rather than throwing', () => {
  assert.equal(decodeSupabaseRole('eyJhbGciOiJIUzI1NiJ9.!!!notbase64!!!.sig'), null);
});

test('returns null for a string that is not a JWT at all', () => {
  assert.equal(decodeSupabaseRole('hello world'), null);
});

test('returns null when the payload is valid base64 but not JSON', () => {
  const notJson = Buffer.from('plain text').toString('base64url');
  assert.equal(decodeSupabaseRole(`eyJhbGciOiJIUzI1NiJ9.${notJson}.sig`), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ren/appwalk && node --test test/audit-supabase.test.js`
Expected: FAIL — `decodeSupabaseRole is not a function` (it is not exported yet).

- [ ] **Step 3: Implement the decoder**

In `src/audit/secrets.js`, add above `scanSecrets`:

```js
// Supabase keys are JWTs whose role claim decides everything: the anon key is
// public by design and ships in every client bundle, while service_role bypasses
// RLS completely. A regex cannot separate them, so decode the payload and read
// the claim. The signature is never verified — we are classifying, not authenticating.
export function decodeSupabaseRole(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const claims = JSON.parse(json);
    if (claims?.iss !== 'supabase') return null;
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ren/appwalk && node --test test/audit-supabase.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Write the failing scan-level test**

Append to `test/audit-supabase.test.js`:

```js
import { scanSecrets } from '../src/audit/secrets.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'appwalk-sb-'));
  const flat = [];
  for (const [name, body] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
    flat.push({ name, path: p });
  }
  return { root, flat };
}

test('flags a service_role key found in source', async () => {
  const t = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role', iat: 1, exp: 2 });
  const found = await scanSecrets(fixture({ 'server.ts': `const key = "${t}";` }));
  const hit = found.find((f) => f.kind === 'supabase_service_role');
  assert.ok(hit, 'service_role key must be reported');
  assert.equal(hit.line, 1);
  assert.ok(!hit.snippet.includes(t), 'the raw key must never appear in the snippet');
});

test('does NOT flag the anon key — it is public by design', async () => {
  const t = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon', iat: 1, exp: 2 });
  const found = await scanSecrets(fixture({ 'client.ts': `const key = "${t}";` }));
  assert.equal(found.filter((f) => f.kind === 'supabase_service_role').length, 0);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd /home/ren/appwalk && node --test test/audit-supabase.test.js`
Expected: FAIL on `service_role key must be reported` — the decoder exists but nothing calls it.

- [ ] **Step 7: Wire the detector into the scan**

In `src/audit/secrets.js`, add to the `PATTERNS` array, after the `generic_key` entry:

```js
  { kind: 'supabase_service_role', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, label: 'Supabase service_role key (bypasses row-level security)', fix: 'This key has been committed — treat it as leaked. The service_role key ignores every row-level security policy, so anyone holding it can read and write your whole database. Rotate it: in Supabase go to Project Settings → API → rotate the service_role key; put the new one in .env (server-side only, NEVER in client code); then purge history (git filter-repo). Your anon key is fine in client code — service_role never is.' },
```

Then, inside `scanSecrets`'s match loop, immediately after the `KNOWN_SAMPLE` check, add the role gate:

```js
          // A Supabase JWT is only a finding when it carries service_role.
          // The anon key is public by design and lives in client code legitimately.
          if (p.kind === 'supabase_service_role' && decodeSupabaseRole(m[0]) !== 'service_role') continue;
```

Note: `continue` moves to the next pattern for this line rather than `break`, so an anon key does not suppress a different secret on the same line.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd /home/ren/appwalk && node --test test/audit-supabase.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 9: Run the whole suite for regressions**

Run: `cd /home/ren/appwalk && npm test`
Expected: all existing tests still pass. The new pattern is broad (any JWT), so a pre-existing fixture containing a non-Supabase JWT would now enter the gate — the gate returns `null` and skips it, but confirm nothing broke.

- [ ] **Step 10: Verify against a real Lovable app**

Run: `cd /home/ren/appwalk && node bin/appwalk.js audit --json /home/ren/appliance-pro-victoriacity | grep -c supabase_service_role`
Expected: `0`. That repo's key is an `anon` key, confirmed by decoding it on 2026-09-17. A non-zero result means the role gate is not working and would produce false positives across the entire study — stop and fix.

- [ ] **Step 11: Commit**

```bash
cd /home/ren/appwalk
git add src/audit/secrets.js test/audit-supabase.test.js
git commit -m "feat(audit): detect leaked Supabase service_role keys

Supabase keys are JWTs and the role claim decides everything: anon is
public by design and ships in every Lovable client bundle, while
service_role bypasses row-level security entirely. A regex cannot tell
them apart, so decode the payload and report only service_role.

appwalk's audience is vibe-coders and the largest vibe-coding platform
ships Supabase by default, so this was the most consequential leak the
tool could not see."
```

#### Discovered during Task 1: the `.env` blind spot

`scanSecrets` deliberately skips `.env` entirely — "shown as a location, never
its values" is a stated project principle and must not change. Confirmed in a
real Lovable app: its Supabase key lives in `.env` and nowhere else, so the
`supabase_service_role` detector never sees it.

Consequence for the study: when a repo commits its `.env`, we report
`env_in_git` but cannot say **what** is inside it. A committed `.env` holding an
anon key and one holding a service_role key are indistinguishable to us, and the
second is catastrophic while the first is close to harmless.

This is the right trade — reading `.env` values to grade them would break the
promise the tool is built on. But it must be stated in the report's limitations,
and it means `supabase_service_role` counts are a **floor, not a total**: they
capture keys pasted into source, not keys sitting in a committed `.env`.

---

### Task 2: Build the repo corpus

**Files:**
- Create: `study/corpus.js`
- Create: `test/study-corpus.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `drawSample(candidates, size, seed)` → `Array<{full_name, clone_url, stars, pushed_at, stratum}>`, and `writeCorpus(rows, path)` → `Promise<number>` (rows written). Task 3 reads that file.

- [ ] **Step 1: Write the failing test**

Create `test/study-corpus.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawSample } from '../study/corpus.js';

const candidates = Array.from({ length: 100 }, (_, i) => ({
  full_name: `owner${i}/repo${i}`,
  clone_url: `https://github.com/owner${i}/repo${i}.git`,
  stars: i,
  pushed_at: '2026-09-01T00:00:00Z',
  stratum: 'lovable',
}));

test('draws the requested number of repos', () => {
  assert.equal(drawSample(candidates, 10, 'seed-a').length, 10);
});

test('is deterministic under the same seed', () => {
  const a = drawSample(candidates, 10, 'seed-a').map((r) => r.full_name);
  const b = drawSample(candidates, 10, 'seed-a').map((r) => r.full_name);
  assert.deepEqual(a, b);
});

test('a different seed gives a different draw', () => {
  const a = drawSample(candidates, 10, 'seed-a').map((r) => r.full_name);
  const b = drawSample(candidates, 10, 'seed-b').map((r) => r.full_name);
  assert.notDeepEqual(a, b);
});

test('never returns the same repo twice', () => {
  const names = drawSample(candidates, 50, 'seed-a').map((r) => r.full_name);
  assert.equal(new Set(names).size, 50);
});

test('returns everything when asked for more than exists', () => {
  assert.equal(drawSample(candidates, 500, 'seed-a').length, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ren/appwalk && node --test test/study-corpus.test.js`
Expected: FAIL — cannot find `../study/corpus.js`.

- [ ] **Step 3: Implement the sampler**

Create `study/corpus.js`:

```js
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// A seeded shuffle, so a published sample can be reproduced by anyone with the
// seed. Math.random would make the study unrepeatable, which is the whole point
// of publishing the method.
function seededOrder(rows, seed) {
  return rows
    .map((row) => ({
      row,
      key: createHash('sha256').update(`${seed}:${row.full_name}`).digest('hex'),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((x) => x.row);
}

export function drawSample(candidates, size, seed) {
  return seededOrder(candidates, seed).slice(0, size);
}

export async function writeCorpus(rows, path) {
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ren/appwalk && node --test test/study-corpus.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the collector script**

Create `study/collect.js`:

```js
// Pages the GitHub Search API for the Lovable stratum and writes a corpus file.
// Search caps at 1000 results per query, so this is a sample of what the API
// will return, not of all 288k matches — state that in the report's method.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { drawSample, writeCorpus } from './corpus.js';

const run = promisify(execFile);
const QUERY = '"lovable.dev" in:readme';
const SEED = process.env.STUDY_SEED || 'lovable-2026-09-17';
const SIZE = Number(process.env.STUDY_SIZE || 50);

async function page(n) {
  const { stdout } = await run('gh', [
    'api', '-X', 'GET', 'search/repositories',
    '--field', `q=${QUERY}`, '--field', 'per_page=100', '--field', `page=${n}`,
  ], { maxBuffer: 20_000_000 });
  return JSON.parse(stdout).items || [];
}

const seen = new Map();
for (let n = 1; n <= 10; n++) {
  const items = await page(n);
  if (!items.length) break;
  for (const it of items) {
    seen.set(it.full_name, {
      full_name: it.full_name,
      clone_url: it.clone_url,
      stars: it.stargazers_count,
      pushed_at: it.pushed_at,
      stratum: 'lovable',
    });
  }
  await new Promise((r) => setTimeout(r, 2500)); // 30 searches/min
}

const sample = drawSample([...seen.values()], SIZE, SEED);
const n = await writeCorpus(sample, 'study/corpus.jsonl');
console.log(`candidates=${seen.size} sampled=${n} seed=${SEED}`);
```

- [ ] **Step 6: Run the pilot collection**

Run: `cd /home/ren/appwalk && STUDY_SIZE=50 node study/collect.js`
Expected: something like `candidates=1000 sampled=50 seed=lovable-2026-09-17`, and `study/corpus.jsonl` has 50 lines.

- [ ] **Step 7: Check the sample looks like real repos**

Run: `head -2 study/corpus.jsonl`
Expected: two JSON objects with plausible `full_name` and a `clone_url` ending `.git`.

- [ ] **Step 8: Keep study output out of git**

```bash
cd /home/ren/appwalk
printf 'study/corpus.jsonl\nstudy/findings.jsonl\nstudy/clones/\n' >> .gitignore
```

- [ ] **Step 9: Commit**

```bash
cd /home/ren/appwalk
git add study/corpus.js study/collect.js test/study-corpus.test.js .gitignore
git commit -m "feat(study): seeded, reproducible corpus sampler for the Lovable stratum"
```

---

### Task 3: The scan harness

**Files:**
- Create: `study/harness.js`
- Create: `test/study-harness.test.js`

**Interfaces:**
- Consumes: `study/corpus.jsonl` from Task 2.
- Produces: `study/findings.jsonl`, one record per repo: `{full_name, stratum, outcome, findings, scanned_at}` where `outcome` is `'ok' | 'clone_failed' | 'timeout' | 'too_large'`. Tasks 4 and 5 read it.

- [ ] **Step 1: Write the failing test**

Create `test/study-harness.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyDone, recordFor } from '../study/harness.js';

test('treats a repo with a finished record as done', () => {
  const done = alreadyDone([{ full_name: 'a/b', outcome: 'ok' }]);
  assert.ok(done.has('a/b'));
});

test('treats a failed clone as done too — do not retry forever', () => {
  const done = alreadyDone([{ full_name: 'a/b', outcome: 'clone_failed' }]);
  assert.ok(done.has('a/b'));
});

test('builds an ok record carrying its findings', () => {
  const rec = recordFor({ full_name: 'a/b', stratum: 'lovable' }, 'ok', [{ kind: 'stripe_live' }]);
  assert.equal(rec.outcome, 'ok');
  assert.equal(rec.findings.length, 1);
  assert.ok(rec.scanned_at);
});

test('a failure record carries no findings rather than undefined', () => {
  const rec = recordFor({ full_name: 'a/b', stratum: 'lovable' }, 'timeout', null);
  assert.deepEqual(rec.findings, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ren/appwalk && node --test test/study-harness.test.js`
Expected: FAIL — cannot find `../study/harness.js`.

- [ ] **Step 3: Implement the resumable pieces**

Create `study/harness.js`:

```js
// A run over hundreds of network clones WILL be interrupted. Every repo gets a
// record whatever happens, so a restart skips finished work and failures show up
// in the published method as sample attrition instead of vanishing.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ren/appwalk && node --test test/study-harness.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the runner**

Append to `study/harness.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, appendFile, rm, mkdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const CLONES = 'study/clones';
const OUT = 'study/findings.jsonl';
const MIN_FREE_GB = 5;

async function readJsonl(path) {
  try {
    const t = await readFile(path, 'utf8');
    return t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

export async function main() {
  const { bsize, bavail } = await statfs('.');
  const freeGb = (bsize * bavail) / 1e9;
  if (freeGb < MIN_FREE_GB) throw new Error(`only ${freeGb.toFixed(1)} GB free; need ${MIN_FREE_GB}`);

  const corpus = await readJsonl('study/corpus.jsonl');
  const done = alreadyDone(await readJsonl(OUT));
  await mkdir(CLONES, { recursive: true });

  for (const repo of corpus) {
    if (done.has(repo.full_name)) continue;
    const dir = join(CLONES, repo.full_name.replace('/', '__'));
    let outcome = 'ok';
    let findings = [];
    try {
      await run('git', ['clone', '--depth', '1', '--single-branch', repo.clone_url, dir],
        { timeout: 120_000 });
      const { stdout } = await run('node', ['bin/appwalk.js', 'audit', '--json', dir],
        { timeout: 120_000, maxBuffer: 50_000_000 });
      findings = JSON.parse(stdout);
    } catch (e) {
      outcome = e.killed ? 'timeout' : 'clone_failed';
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await appendFile(OUT, JSON.stringify(recordFor(repo, outcome, findings)) + '\n');
    console.log(`${repo.full_name} ${outcome} findings=${findings.length}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
```

- [ ] **Step 6: Run the 50-repo pilot**

Run: `cd /home/ren/appwalk && node study/harness.js`
Expected: 50 lines of progress output. Some will be `clone_failed` — repos go private or get deleted, and that is normal and recorded, not an error.

- [ ] **Step 7: Confirm resumability**

Run: `cd /home/ren/appwalk && node study/harness.js`
Expected: exits immediately with no new output — every repo already has a record.

- [ ] **Step 8: Confirm clones were cleaned up**

Run: `ls study/clones | wc -l`
Expected: `0`. Anything else means the cleanup path leaks disk and will fill the SSD at 1,000 repos.

- [ ] **Step 9: Commit**

```bash
cd /home/ren/appwalk
git add study/harness.js test/study-harness.test.js
git commit -m "feat(study): resumable clone-audit-delete harness with a disk floor"
```

---

### Task 4: Classify fixtures vs real leaks

**Files:**
- Create: `study/classify.js`
- Create: `test/study-classify.test.js`

**Interfaces:**
- Consumes: findings records from Task 3.
- Produces: `classify(finding)` → `{severity: 'high'|'low', fixture: boolean}`. Task 5 consumes it.

- [ ] **Step 1: Write the failing test**

Create `test/study-classify.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, HIGH_KINDS } from '../study/classify.js';

test('a service_role key in source is high severity', () => {
  const got = classify({ kind: 'supabase_service_role', file: '/r/src/db.ts', snippet: 'eyJh…ture' });
  assert.equal(got.severity, 'high');
  assert.equal(got.fixture, false);
});

test('the same key under test/ is a fixture', () => {
  const got = classify({ kind: 'supabase_service_role', file: '/r/test/db.test.ts', snippet: 'eyJh…ture' });
  assert.equal(got.fixture, true);
  assert.equal(got.severity, 'low');
});

test('docs and examples are fixtures too', () => {
  for (const dir of ['docs', 'examples', '__tests__', 'fixtures', 'spec']) {
    assert.equal(classify({ kind: 'stripe_live', file: `/r/${dir}/x.md`, snippet: 'sk_l…cdef' }).fixture, true, dir);
  }
});

test('placeholder snippets are fixtures wherever they live', () => {
  assert.equal(classify({ kind: 'generic_key', file: '/r/src/a.ts', snippet: 'your-key-here' }).fixture, true);
  assert.equal(classify({ kind: 'generic_key', file: '/r/src/a.ts', snippet: 'xxxx…xxxx' }).fixture, true);
});

test('a hygiene kind is low severity even when real', () => {
  assert.equal(classify({ kind: 'slack', file: '/r/src/a.ts', snippet: 'xoxb…1234' }).severity, 'low');
});

test('the high-severity set is exactly the seven agreed kinds', () => {
  assert.deepEqual([...HIGH_KINDS].sort(), [
    'aws', 'db_url', 'env_in_git', 'github', 'private_key', 'stripe_live', 'supabase_service_role',
  ].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ren/appwalk && node --test test/study-classify.test.js`
Expected: FAIL — cannot find `../study/classify.js`.

- [ ] **Step 3: Implement**

Create `study/classify.js`:

```js
// The six kinds that can cost someone money or data today, plus the Supabase
// service_role key added for this study — seven in total. Everything else is hygiene: counted in
// the aggregate, never emailed, because notifying on hygiene reads as spam.
export const HIGH_KINDS = new Set([
  'stripe_live', 'db_url', 'aws', 'private_key', 'github', 'env_in_git', 'supabase_service_role',
]);

const FIXTURE_DIR = /(^|\/)(tests?|__tests__|fixtures?|spec|docs|examples)(\/|$)/i;
const PLACEHOLDER = /^(x+…?x*|your-|example|changeme|placeholder|abc123)/i;

export function classify(finding) {
  const fixture = FIXTURE_DIR.test(finding.file || '') || PLACEHOLDER.test(finding.snippet || '');
  const severity = !fixture && HIGH_KINDS.has(finding.kind) ? 'high' : 'low';
  return { severity, fixture };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ren/appwalk && node --test test/study-classify.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/ren/appwalk
git add study/classify.js test/study-classify.test.js
git commit -m "feat(study): fixture-vs-leak classification and the high-severity set"
```

---

### Task 5: Aggregate into the publication view

**Files:**
- Create: `study/aggregate.js`
- Create: `test/study-aggregate.test.js`

**Interfaces:**
- Consumes: Task 3's findings records and Task 4's `classify`.
- Produces: `aggregate(records)` → `{sample, attrition, byKind, highSeverityRepos, fixtureRate}` with every repo identifier hashed.

- [ ] **Step 1: Write the failing test**

Create `test/study-aggregate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../study/aggregate.js';

const records = [
  { full_name: 'a/b', stratum: 'lovable', outcome: 'ok',
    findings: [{ kind: 'supabase_service_role', file: '/r/src/db.ts', snippet: 'eyJh…ture' }] },
  { full_name: 'c/d', stratum: 'lovable', outcome: 'ok',
    findings: [{ kind: 'stripe_live', file: '/r/test/x.js', snippet: 'sk_l…cdef' }] },
  { full_name: 'e/f', stratum: 'lovable', outcome: 'clone_failed', findings: [] },
];

test('counts the sample and its attrition separately', () => {
  const got = aggregate(records);
  assert.equal(got.sample, 3);
  assert.equal(got.attrition.clone_failed, 1);
});

test('counts findings by kind', () => {
  assert.equal(aggregate(records).byKind.supabase_service_role, 1);
});

test('counts repos with at least one high-severity real leak', () => {
  assert.equal(aggregate(records).highSeverityRepos, 1);
});

test('reports the fixture rate rather than hiding it', () => {
  assert.equal(aggregate(records).fixtureRate, 0.5);
});

test('NO plaintext repo name survives into the publication view', () => {
  const json = JSON.stringify(aggregate(records));
  for (const name of ['a/b', 'c/d', 'e/f']) {
    assert.ok(!json.includes(name), `${name} leaked into the published view`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ren/appwalk && node --test test/study-aggregate.test.js`
Expected: FAIL — cannot find `../study/aggregate.js`.

- [ ] **Step 3: Implement**

Create `study/aggregate.js`:

```js
import { createHash } from 'node:crypto';
import { classify } from './classify.js';

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function aggregate(records) {
  const out = {
    sample: records.length,
    attrition: {},
    byKind: {},
    highSeverityRepos: 0,
    fixtureRate: 0,
    repos: [],
  };
  let findings = 0;
  let fixtures = 0;

  for (const rec of records) {
    if (rec.outcome !== 'ok') {
      out.attrition[rec.outcome] = (out.attrition[rec.outcome] || 0) + 1;
    }
    let high = false;
    for (const f of rec.findings) {
      findings++;
      const c = classify(f);
      if (c.fixture) fixtures++;
      if (c.severity === 'high') high = true;
      out.byKind[f.kind] = (out.byKind[f.kind] || 0) + 1;
    }
    if (high) out.highSeverityRepos++;
    out.repos.push({ id: hash(rec.full_name), stratum: rec.stratum, outcome: rec.outcome, high });
  }

  out.fixtureRate = findings ? fixtures / findings : 0;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ren/appwalk && node --test test/study-aggregate.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Produce the pilot aggregate**

Run:

```bash
cd /home/ren/appwalk && node -e "
import('./study/aggregate.js').then(async (m) => {
  const { readFile } = await import('node:fs/promises');
  const recs = (await readFile('study/findings.jsonl','utf8')).split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(m.aggregate(recs), null, 2).slice(0, 2000));
});
"
```

Expected: a JSON summary over the 50 pilot repos. **This is the number that decides whether the study is worth publishing** — if high-severity repos is 0 of 50, say so to Kevin before scaling to 1,000 rather than assuming a bigger sample will find more.

- [ ] **Step 6: Commit**

```bash
cd /home/ren/appwalk
git add study/aggregate.js test/study-aggregate.test.js
git commit -m "feat(study): hashed publication view with attrition and fixture rate"
```

---

## Stops before the full run

After the pilot aggregate, **stop and show Kevin the numbers.** Scaling to 1,000 repos, the disclosure round, and the report page all depend on the pilot showing a real signal. A null result is a legitimate outcome and would change the story rather than end it — but it is his call, not an automatic next step.

Notification (`study/notify.js`) is deliberately not in this plan. It needs the pilot's shape first, and sending mail to strangers is not something to build speculatively.
