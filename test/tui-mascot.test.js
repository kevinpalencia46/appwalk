// test/tui-mascot.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASCOT_FRAMES, MASCOT_ROWS, MASCOT_COLS, MASCOT_STATIC, renderMascot, animateMascot } from '../src/tui/mascot.js';

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

test('mascot ships a 4-frame walk cycle of 14 rows x exactly 40 columns', () => {
  assert.equal(MASCOT_FRAMES.length, 4, 'a four-frame walk cycle');
  assert.equal(MASCOT_ROWS, 14);
  assert.equal(MASCOT_COLS, 40);
});

test('every frame is fixed-width: all 4x14 rows are exactly 40 columns', () => {
  MASCOT_FRAMES.forEach((f, fi) => {
    assert.equal(f.length, MASCOT_ROWS, `frame ${fi} has ${MASCOT_ROWS} rows`);
    f.forEach((row, ri) => {
      assert.equal(row.length, MASCOT_COLS, `frame ${fi} row ${ri} is ${MASCOT_COLS} cols (got ${row.length})`);
    });
  });
});

test('the rendered mascot uses the lantern amber ONLY on the flame', () => {
  const frame = renderMascot(0, true);
  assert.ok(frame.includes('\x1b[38;2;255;179;0m*\x1b[0m'), 'flame renders in lantern amber');
  assert.ok(!strip(frame).includes('*'.repeat(2)), 'exactly one flame mark per frame');
  assert.equal(strip(frame).split('\n').length, MASCOT_ROWS);
});

test('flicker-off dims the flame but keeps it amber', () => {
  const off = renderMascot(0, false);
  assert.ok(off.includes('\x1b[2m\x1b[38;2;255;179;0m*'), 'flicker-off flame is dimmed amber');
});

test('the flame reset never leaks: every non-flame row re-opens phosphor green', () => {
  // amber('*') ends in the universal \x1b[0m, which would drop the whole rest of
  // the frame to the terminal default (pink on Kevin's recolored terminal). Each
  // non-flame row must carry its own phosphor-green run, flicker on AND off.
  for (const flick of [true, false]) {
    for (let fi = 0; fi < MASCOT_FRAMES.length; fi++) {
      const lines = renderMascot(fi, flick).split('\n');
      assert.equal(lines.length, MASCOT_ROWS);
      lines.forEach((line, ri) => {
        if (!line.includes('\x1b[38;2;255;179;0m*')) {
          assert.ok(
            line.includes('\x1b[38;2;51;255;102m'),
            `frame ${fi} flicker=${flick} row ${ri} keeps phosphor green after the flame reset`,
          );
        }
      });
    }
  }
});

test('the static pose is 14 rows of phosphor-green linework', () => {
  const lines = MASCOT_STATIC.split('\n');
  assert.equal(lines.length, MASCOT_ROWS);
  // linework wrapped in phosphor green, not raw or another color
  assert.ok(MASCOT_STATIC.includes('\x1b[38;2;51;255;102m'), 'linework is phosphor green');
  assert.ok(!MASCOT_STATIC.includes('\x1b[38;2;31;153;64m'), 'no dim-green in the mascot body');
});

test('animateMascot on a non-TTY emits one static frame and a noop cleanup', () => {
  let captured = '';
  const fake = { isTTY: false, write: (s) => { captured += s; } };
  const cleanup = animateMascot(fake);
  assert.equal(typeof cleanup, 'function');
  assert.equal(captured, MASCOT_STATIC + '\n', 'non-TTY gets the static pose once');
  assert.doesNotThrow(cleanup, 'the returned cleanup is a safe noop');
});

// Swap in a fake stdin (a real keypress stream would be leaked into flowing mode and
// hang the test child forever). process.stdin is a configurable getter, so redefine
// it — but snapshot the REAL stream first and restore that exact value, mirroring the
// piped-stdin test below. (Overwriting the accessor with a data property means `delete`
// can't bring the getter back, and restoring an undefined nativeStdin would clobber
// real stdin for the rest of the test process.)
function withFakeStdin(fn) {
  const real = process.stdin;
  const handlers = {};
  const fakeStdin = {
    isTTY: true,
    setRawMode: () => {},
    on: (ev, fn) => { handlers[ev] = fn; },
    removeListener: (ev, fn) => { if (handlers[ev] === fn) delete handlers[ev]; },
  };
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
  try { fn(handlers); }
  finally { Object.defineProperty(process, 'stdin', { value: real, configurable: true }); }
}

test('animateMascot on a TTY saves/restores the cursor and returns a cleanup', () => {
  withFakeStdin((handlers) => {
    let out = '';
    const fake = { isTTY: true, write: (s) => { out += s; } };
    const cleanup = animateMascot(fake, { row: 2, col: 6 });
    assert.equal(typeof cleanup, 'function');
    assert.equal(typeof handlers.data, 'function', 'listens for the first keypress');
    assert.ok(out.startsWith('\x1b[s\x1b[?25l'), 'saves cursor and hides it');
    assert.ok(out.includes('\x1b[2;6H'), 'rewrites mascot rows in place (first row)');
    assert.ok(out.includes('\x1b[15;6H'), 'rewrites mascot rows in place (last row)');
    assert.ok(!out.includes('\x1b[2J'), 'never full-repaints the screen');
    assert.ok(out.includes('\x1b[38;2;255;179;0m*'), 'the in-place rewrite carries the amber flame');
    cleanup();
    assert.ok(out.endsWith('\x1b[u\x1b[?25h'), 'restores the cursor on cleanup');
    assert.equal(handlers.data, undefined, 'cleanup detaches the keypress listener');
  });
});

test('animateMascot stops on the first keypress', () => {
  withFakeStdin((handlers) => {
    let out = '';
    const fake = { isTTY: true, write: (s) => { out += s; } };
    animateMascot(fake, { row: 2, col: 6 });
    assert.equal(typeof handlers.data, 'function');
    handlers.data('q');                       // the "stop on first keypress" trigger
    assert.equal(handlers.data, undefined, 'keypress clears both intervals and the listener');
    assert.ok(out.endsWith('\x1b[u\x1b[?25h'), 'cursor is restored on the keypress');
  });
});

test('animateMascot ignores a piped (non-interactive) stdin', (t) => {
  const orig = process.stdin;
  Object.defineProperty(process, 'stdin', { value: { isTTY: false }, configurable: true });
  try {
    let out = '';
    const fake = { isTTY: true, write: (s) => { out += s; } };
    const cleanup = animateMascot(fake, { row: 2, col: 6 });
    cleanup();
    assert.ok(out.startsWith('\x1b[s\x1b[?25l'), 'animates but...');
    assert.ok(out.endsWith('\x1b[u\x1b[?25h'), '...restores the cursor on cleanup');
  } finally {
    Object.defineProperty(process, 'stdin', { value: orig, configurable: true });
  }
});
