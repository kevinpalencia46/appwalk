// test/monitor.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCrash } from '../src/monitor.js';
test('isCrash flags stack traces and throw lines', () => {
  assert.ok(isCrash('TypeError: Cannot read properties of undefined'));
  assert.ok(isCrash('Error: listen EADDRINUSE'));
  assert.ok(!isCrash('GET / 200'));
  assert.ok(!isCrash('info: server started'));
});
