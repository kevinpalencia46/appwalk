// test/tui-kit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { box, bar, g, dg, dim, decodeKey, visLen, boxWidth } from '../src/tui/kit.js';

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

test('box draws a framed panel with a title', () => {
  const out = strip(box('hello', ['one', 'two'], { width: 16 }));
  assert.match(out, /┌─ hello/);
  assert.match(out, /│ one/);
  assert.match(out, /└────/);
});
test('box clamps a tiny width up to the 44-column minimum', () => {
  const out = box('t', ['x'], { width: 4 });
  assert.equal(visLen(out.split('\n')[0]), 44);
});
test('box truncates an over-long title to keep the frame inside width', () => {
  const out = box('x'.repeat(50), ['y'], { width: 50 });
  assert.ok(visLen(out.split('\n')[0]) <= 50);
});
test('box supports width "full" (terminal minus a 2-col margin)', () => {
  // In the test env columns is undefined → W() = 80 → full = 78.
  const out = box('t', ['x'], { width: 'full' });
  assert.equal(visLen(out.split('\n')[0]), 78);
});
test('box caps content width at 78 so no line exceeds ~74 columns', () => {
  // In the test env columns is undefined → W() = 80 → full = 78.
  assert.equal(boxWidth('full'), 78);
  assert.equal(boxWidth(200), 78);
  const out = box('t', ['x'.repeat(120)], { width: 200 });
  const widest = Math.max(...out.split('\n').map((l) => visLen(l)));
  assert.ok(widest <= 78, `widest box line is ${widest} columns`);
});
test('box full height pads the content up toward the terminal height', () => {
  const prev = process.stdout.rows;
  process.stdout.rows = 30;
  try {
    const out = box('t', ['x'], { height: 'full' });
    const n = out.split('\n').length;
    // 30-row terminal → content target 27 → box is 29 lines, leaving the bar row.
    assert.equal(n, 29);
  } finally {
    process.stdout.rows = prev;
  }
});
test('colors wrap in ANSI codes (phosphor palette)', () => {
  assert.equal(g('ok'), '\x1b[38;2;51;255;102mok\x1b[0m');
  assert.equal(dg('ok'), '\x1b[38;2;31;153;64mok\x1b[0m');
  assert.equal(dim('x'), '\x1b[2mx\x1b[0m');
});
test('box pads ANSI rows by visible width so colored and plain rows are equal, keeping the reset', () => {
  const width = 44;              // box() clamps widths to a 44 minimum → inner = 40
  const inner = width - 4;
  const colored = g('▶ ' + 'x'.repeat(40));     // green run that must be truncated at a code boundary
  const plain = '▶ ' + 'x'.repeat(40);
  const out = box('t', [colored, plain], { width });
  const lines = out.split('\n');
  // borders are colored too, so strip ANSI first, then drop the border glyphs
  const unbox = (s) => strip(s).replace(/^│ /, '').replace(/ │$/, '');
  const rColored = unbox(lines[1]);
  const rPlain = unbox(lines[2]);
  assert.equal(visLen(rColored), inner, 'colored row fills the inner width in visible columns');
  assert.equal(visLen(rPlain), inner, 'plain row fills the inner width in visible columns');
  assert.equal(visLen(rColored), visLen(rPlain), 'colored and plain rows are the same visible width');
  // the truncated colored content (between the dim-green borders) still ends with a reset
  const contentRaw = lines[1].replace(/^\x1b\[38;2;31;153;64m│ \x1b\[0m/, '').replace(/\x1b\[38;2;31;153;64m │\x1b\[0m$/, '');
  assert.ok(contentRaw.endsWith('\x1b[0m'), 'truncated colored row still ends with a color reset');
});
test('box borders are dim green and the title phosphor green', () => {
  const out = box('hi', ['x']);
  assert.ok(out.includes('\x1b[38;2;31;153;64m┌─ \x1b[0m'), 'top-left border is dim green');
  assert.ok(out.includes('\x1b[38;2;51;255;102mhi\x1b[0m'), 'title is phosphor green');
  assert.ok(out.includes('\x1b[38;2;31;153;64m│ \x1b[0m'), 'side borders are dim green');
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
test('bar renders a quiet inverted status line and highlights only ENTER', () => {
  const out = bar('tour', 'Press ENTER to continue · q quit');
  assert.ok(out.startsWith('\x1b[2;7m'), 'bar starts with dim inverse video');
  assert.ok(out.includes('\x1b[1;38;2;51;255;102mENTER\x1b[0m'), 'the primary key is bright phosphor inside the bar');
});
