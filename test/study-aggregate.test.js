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
  assert.equal(got.scanned, 2);
  assert.equal(got.attrition.clone_failed, 1);
});

test('counts findings by kind', () => {
  assert.equal(aggregate(records).byKind.supabase_service_role, 1);
  assert.equal(aggregate(records).byKind.stripe_live, 1);
});

test('counts repos with at least one high-severity real leak', () => {
  assert.equal(aggregate(records).highSeverityRepos, 1);
});

test('reports the fixture rate rather than hiding it', () => {
  assert.equal(aggregate(records).fixtureRate, 0.5);
});

test('a fixture-only repo is not counted as high severity', () => {
  const got = aggregate([records[1]]);
  assert.equal(got.highSeverityRepos, 0);
});

test('NO plaintext repo name survives into the publication view', () => {
  const json = JSON.stringify(aggregate(records));
  for (const name of ['a/b', 'c/d', 'e/f']) {
    assert.ok(!json.includes(name), `${name} leaked into the published view`);
  }
});

test('an empty run does not divide by zero', () => {
  const got = aggregate([]);
  assert.equal(got.sample, 0);
  assert.equal(got.fixtureRate, 0);
});
