import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { scanSecrets } from '../src/audit/secrets.js';

test('scanSecrets finds live keys, db urls, and .env committed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sec-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'config.js'), 'const k = "sk_live_1234567890abcdef";\nconst a = "AKIA1234567890ABCDEF";');
  await writeFile(join(root, 'db.js'), 'const u = "postgres://admin:hunter2@db.example.com:5432/app";');
  await writeFile(join(root, '.env'), 'API_KEY=secret\n');
  const map = await buildMap(root);
  const finds = await scanSecrets(map);
  assert.ok(finds.some((f) => f.kind === 'stripe_live'));
  assert.ok(finds.some((f) => f.kind === 'db_url'));
  assert.ok(finds.some((f) => f.kind === 'aws'));
  assert.ok(finds.some((f) => f.kind === 'env_in_git'));
  assert.ok(finds.every((f) => !f.snippet.includes('hunter2')), 'snippets must be masked, never raw secrets');
  assert.ok(finds.every((f) => f.category === 'secrets' && typeof f.fix === 'string' && f.fix.length > 0), 'every secret finding carries a category + fix');
});

test('scanSecrets does not flag test/sample keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sec-ok-'));
  await writeFile(join(root, 'ok.js'), 'const k = "sk_test_123"; const a = "AKIAIOSFODNN7EXAMPLE";');
  const map = await buildMap(root);
  const finds = await scanSecrets(map);
  assert.equal(finds.length, 0);
});
