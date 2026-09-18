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

test('docs, examples and spec dirs are fixtures too', () => {
  for (const dir of ['docs', 'examples', '__tests__', 'fixtures', 'spec', 'tests']) {
    assert.equal(
      classify({ kind: 'stripe_live', file: `/r/${dir}/x.md`, snippet: 'sk_l…cdef' }).fixture,
      true,
      `${dir} should be treated as a fixture`,
    );
  }
});

test('a directory merely containing the word test is not a fixture', () => {
  const got = classify({ kind: 'stripe_live', file: '/r/src/latest/api.ts', snippet: 'sk_l…cdef' });
  assert.equal(got.fixture, false, '"latest" must not match the tests/ rule');
});

test('placeholder snippets are fixtures wherever they live', () => {
  for (const snip of ['your-key-here', 'xxxxxxxx', 'changeme', 'example', 'placeholder', 'abc123']) {
    assert.equal(
      classify({ kind: 'generic_key', file: '/r/src/a.ts', snippet: snip }).fixture,
      true,
      `${snip} should be treated as a placeholder`,
    );
  }
});

test('a hygiene kind is low severity even when real', () => {
  assert.equal(classify({ kind: 'slack', file: '/r/src/a.ts', snippet: 'xoxb…1234' }).severity, 'low');
  assert.equal(classify({ kind: 'google', file: '/r/src/a.ts', snippet: 'AIza…1234' }).severity, 'low');
});

test('the high-severity set is exactly the seven agreed kinds', () => {
  assert.deepEqual([...HIGH_KINDS].sort(), [
    'aws', 'db_url', 'env_in_git', 'github', 'private_key', 'stripe_live', 'supabase_service_role',
  ]);
});

test('missing file or snippet does not throw', () => {
  assert.equal(classify({ kind: 'env_in_git' }).severity, 'high');
});
