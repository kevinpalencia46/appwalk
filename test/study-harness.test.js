import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyDone, recordFor } from '../study/harness.js';

test('treats a repo with a finished record as done', () => {
  assert.ok(alreadyDone([{ full_name: 'a/b', outcome: 'ok' }]).has('a/b'));
});

test('treats a failed clone as done too — do not retry forever', () => {
  assert.ok(alreadyDone([{ full_name: 'a/b', outcome: 'clone_failed' }]).has('a/b'));
});

test('an empty ledger means nothing is done', () => {
  assert.equal(alreadyDone([]).size, 0);
});

test('builds an ok record carrying its findings', () => {
  const rec = recordFor({ full_name: 'a/b', stratum: 'lovable' }, 'ok', [{ kind: 'stripe_live' }]);
  assert.equal(rec.outcome, 'ok');
  assert.equal(rec.full_name, 'a/b');
  assert.equal(rec.stratum, 'lovable');
  assert.equal(rec.findings.length, 1);
  assert.ok(rec.scanned_at, 'every record is timestamped');
});

test('a failure record carries an empty array, never undefined', () => {
  assert.deepEqual(recordFor({ full_name: 'a/b', stratum: 'lovable' }, 'timeout', null).findings, []);
  assert.deepEqual(recordFor({ full_name: 'a/b', stratum: 'lovable' }, 'clone_failed').findings, []);
});

import { assertScannedTheClone } from '../study/harness.js';

test('accepts findings that live inside the clone', () => {
  assert.doesNotThrow(() =>
    assertScannedTheClone([{ file: '/clones/a__b/src/x.ts' }], '/clones/a__b', 'a/b'));
});

test('throws when the audit scanned somewhere else entirely', () => {
  assert.throws(
    () => assertScannedTheClone([{ file: '/home/ren/appwalk/test/fixture.js' }], '/clones/a__b', 'a/b'),
    /scanned the wrong directory/,
  );
});

test('findings without a file path do not trip the guard', () => {
  assert.doesNotThrow(() => assertScannedTheClone([{ kind: 'env_in_git' }], '/clones/a__b', 'a/b'));
});

test('deps labels are descriptions, not paths — the guard ignores them', () => {
  assert.doesNotThrow(() =>
    assertScannedTheClone([{ file: 'package.json → zod' }], '/clones/a__b', 'a/b'));
});

test('the .env sentinel is relative and does not trip the guard', () => {
  assert.doesNotThrow(() =>
    assertScannedTheClone([{ file: '.env', kind: 'env_in_git' }], '/clones/a__b', 'a/b'));
});
