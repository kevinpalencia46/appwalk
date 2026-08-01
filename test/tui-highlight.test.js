// test/tui-highlight.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight } from '../src/tui/highlight.js';

test('highlight colors keywords blue, strings green, comments dim', () => {
  const out = highlight('const x = "hi"; // note', 'js');
  assert.match(out, /\x1b\[34mconst\x1b\[0m/);      // keyword blue
  assert.match(out, /\x1b\[32m"hi"\x1b\[0m/);        // string green
  assert.match(out, /\x1b\[2m\/\/ note\x1b\[0m/);    // comment dim
});
test('highlight passes unknown languages through unchanged', () => {
  const s = 'anything goes';
  assert.equal(highlight(s, 'txt'), s);
});
