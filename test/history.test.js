// test/history.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileHistory } from '../src/history.js';
test('fileHistory returns null outside a git repo (never throws)', async () => {
  const h = await fileHistory('/tmp', 'x.js');
  assert.equal(h, null);
});
