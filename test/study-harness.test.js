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
