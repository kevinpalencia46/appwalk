// test/tui-kit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { box, bar, g, dim, decodeKey } from '../src/tui/kit.js';

test('box draws a framed panel with a title', () => {
  const out = box('hello', ['one', 'two'], { width: 16 });
  assert.match(out, /┌─ hello/);
  assert.match(out, /│ one/);
  assert.match(out, /└────/);
});
test('colors wrap in ANSI codes', () => {
  assert.equal(g('ok'), '\x1b[32mok\x1b[0m');
  assert.equal(dim('x'), '\x1b[2mx\x1b[0m');
});
test('decodeKey handles arrows, enter, letters, split escapes, and CRLF', () => {
  assert.deepEqual(decodeKey('\x1b[A'), { token: 'up', used: 3 });
  assert.deepEqual(decodeKey('\x1b[B'), { token: 'down', used: 3 });
  assert.deepEqual(decodeKey('\x1b[C'), { token: 'right', used: 3 });
  assert.deepEqual(decodeKey('\x1b[D'), { token: 'left', used: 3 });
  assert.deepEqual(decodeKey('\r'), { token: 'enter', used: 1 });
  assert.deepEqual(decodeKey('\r\n'), { token: 'enter', used: 2 });
  assert.deepEqual(decodeKey('q'), { token: 'q', used: 1 });
  assert.deepEqual(decodeKey('\x1b'), { token: null, used: 1 });   // lone esc: consume, no token
});
test('bar renders an inverse-video status line', () => {
  const out = bar('tree', '↑↓ move · q quit');
  assert.ok(out.startsWith('\x1b[7m'));
});
