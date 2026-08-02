import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/home.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('home render shows the project name and 7 framed buttons (no mascot)', () => {
  const s = render(init(), { root: '/home/ren/great-pacific' });
  assert.match(s, /appwalk/);
  assert.match(s, /GREAT-PACIFIC/);
  // 3×3 buttons are 23 cols wide under the 78-col box cap, so long labels/descs
  // truncate. "Take the gui" and "See your setti" are the truncated prefixes of the
  // first button's label and the 7th button's desc — and prefixes of the full
  // strings, so they still hold if the grid ever widens.
  assert.match(s, /Take the gui/, 'the tour button label renders');
  assert.match(s, /Your setup/, 'the 7th button renders');
  assert.match(s, /See your setti/, "the 7th button's description renders");
  const tops = strip(s).match(/┌─+┐/g) || [];
  assert.equal(tops.length, 7, 'seven button frames render, not a list');
  assert.doesNotMatch(s, /o   o/, 'the ASCII duck is gone');
  assert.doesNotMatch(s, /🚶|🗂|🛡|💬|📖/, 'no emoji in the home menu');
  assert.match(s, /→|▸|!|\?|»|↦|▣/, 'menu icons are ASCII/box-drawing glyphs');
});

test('home render celebrates when the tour just finished', () => {
  const plain = render(init(), { root: '/x' });
  assert.doesNotMatch(plain, /You did it/);
  const celebrating = render(init({ celebrate: true }), { root: '/x' });
  assert.match(celebrating, /★ You did it!/);
});

test('home step: 3×3 grid — 2D arrows, empty cells clamp, no phantom slot', () => {
  let s = init();
  assert.equal(step(s, 'right').c, 1, 'right moves across row 0');
  s = step(s, 'right');
  assert.equal(step(s, 'right').c, 2);
  assert.equal(step(s, 'down').r, 1);
  assert.equal(step({ r: 1, c: 2 }, 'down').r, 2, 'down from the flow button lands on config');
  assert.equal(step({ r: 1, c: 2 }, 'down').c, 0, '…at the left, skipping the empty cells');
  assert.equal(step({ r: 2, c: 0 }, 'down').r, 0, 'bottom wraps to top');
  assert.equal(step({ r: 0, c: 0 }, 'up').r, 2, 'top wraps to bottom');
  assert.equal(step({ r: 2, c: 0 }, 'right').c, 0, 'right past the empty cells wraps in place');
  assert.deepEqual(step({ r: 0, c: 0 }, 'enter'), { to: 'tour' });
  assert.deepEqual(step({ r: 0, c: 2 }, 'enter'), { to: 'audit' });
  assert.deepEqual(step({ r: 1, c: 2 }, 'enter'), { to: 'flow' });
  assert.deepEqual(step({ r: 2, c: 0 }, 'enter'), { to: 'config' });
  assert.deepEqual(step(init(), 'q'), { done: true });
});
