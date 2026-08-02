// test/tui-kit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { box, bar, g, dim, decodeKey, visLen, MASCOT } from '../src/tui/kit.js';

test('box draws a framed panel with a title', () => {
  const out = box('hello', ['one', 'two'], { width: 16 });
  assert.match(out, /┌─ hello/);
  assert.match(out, /│ one/);
  assert.match(out, /└────/);
});
test('box clamps a tiny width up to the 44-column minimum', () => {
  const out = box('t', ['x'], { width: 4 });
  assert.equal(out.split('\n')[0].length, 44);
});
test('box truncates an over-long title to keep the frame inside width', () => {
  const out = box('x'.repeat(50), ['y'], { width: 50 });
  assert.ok(out.split('\n')[0].length <= 50);
});
test('box supports width "full" (terminal minus a 2-col margin)', () => {
  // In the test env columns is undefined → W() = 80 → full = 78.
  const out = box('t', ['x'], { width: 'full' });
  assert.equal(out.split('\n')[0].length, 78);
});
test('colors wrap in ANSI codes', () => {
  assert.equal(g('ok'), '\x1b[32mok\x1b[0m');
  assert.equal(dim('x'), '\x1b[2mx\x1b[0m');
});
test('box pads ANSI rows by visible width so colored and plain rows are equal, keeping the reset', () => {
  const width = 44;              // box() clamps widths to a 44 minimum → inner = 40
  const inner = width - 4;
  const colored = g('▶ ' + 'x'.repeat(40));     // green run that must be truncated at a code boundary
  const plain = '▶ ' + 'x'.repeat(40);
  const out = box('t', [colored, plain], { width });
  const lines = out.split('\n');
  const strip = (s) => s.replace(/^│ /, '').replace(/ │$/, '');
  const rColored = strip(lines[1]);
  const rPlain = strip(lines[2]);
  assert.equal(visLen(rColored), inner, 'colored row fills the inner width in visible columns');
  assert.equal(visLen(rPlain), inner, 'plain row fills the inner width in visible columns');
  assert.equal(visLen(rColored), visLen(rPlain), 'colored and plain rows are the same visible width');
  assert.ok(rColored.endsWith('\x1b[0m'), 'truncated colored row still ends with a color reset');
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
test('bar renders a bold inverse-video status line and highlights ENTER', () => {
  const out = bar('tour', 'Press ENTER to continue · q quit');
  assert.ok(out.startsWith('\x1b[1;7m'));
  assert.ok(out.includes('\x1b[1;93mENTER\x1b[0m'), 'the primary action is bright yellow inside the bar');
});
test('MASCOT is a small static string', () => {
  assert.ok(MASCOT.includes('•_•'));
  assert.ok(MASCOT.split('\n').length <= 3, 'mascot is at most 3 lines');
});
