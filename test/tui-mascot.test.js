// test/tui-mascot.test.js
// The mascot is a PLACEHOLDER: Kevin is drawing the real duck-with-lantern in
// Procreate and will spec the ASCII later. Until then src/tui/mascot.js ships a
// no-op that keeps the import surface stable. These tests pin that no-op contract
// so the real art can be dropped in later without touching the rest of the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASCOT_FRAMES, MASCOT_ROWS, MASCOT_COLS, MASCOT_STATIC, renderMascot, animateMascot } from '../src/tui/mascot.js';

test('mascot ships empty until the real art lands (no-op render)', () => {
  assert.equal(MASCOT_FRAMES.length, 0, 'no frames yet');
  assert.equal(MASCOT_ROWS, 0);
  assert.equal(MASCOT_COLS, 0);
  assert.equal(MASCOT_STATIC, '', 'no static pose on screen');
  assert.equal(renderMascot(0, true), '', 'renderMascot is a no-op');
  assert.equal(renderMascot(0, false), '', 'flicker is a no-op too');
});

test('animateMascot returns a safe no-op cleanup', () => {
  const cleanup = animateMascot({ isTTY: true, write: () => {} });
  assert.equal(typeof cleanup, 'function');
  assert.doesNotThrow(cleanup, 'the no-op cleanup is safe to call');
});
