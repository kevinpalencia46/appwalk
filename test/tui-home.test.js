// test/tui-home.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/home.js';

test('home render shows the project name and 5 choices (no mascot)', () => {
  const s = render(init(), { root: '/home/ren/great-pacific' });
  assert.match(s, /appwalk/);
  assert.match(s, /GREAT-PACIFIC/, 'project name is shown big');
  assert.match(s, /★/, 'the project name is shown as a phosphor header');
  assert.match(s, /guided tour/);
  assert.match(s, /Explore your files/);
  assert.match(s, /Audit for safety/);
  assert.match(s, /Ask about a file/);
  assert.match(s, /Learn the words/);
  assert.doesNotMatch(s, /o   o/, 'the ASCII duck is gone from home until the real art lands');
  // the menu glyphs are single-width box/arrow chars, never astral-plane emoji
  assert.doesNotMatch(s, /🚶|🗂|🛡|💬|📖/, 'no emoji in the home menu');
  assert.match(s, /→|▸|!|\?|»/, 'menu icons are ASCII/box-drawing glyphs');
});
test('home render celebrates when the tour just finished', () => {
  const plain = render(init(), { root: '/x' });
  assert.doesNotMatch(plain, /You did it/);
  const celebrating = render(init({ celebrate: true }), { root: '/x' });
  assert.match(celebrating, /★ You did it!/);
});
test('home step: arrows move, enter routes, q quits', () => {
  let s = init();
  assert.equal(step(s, 'down').sel, 1);
  assert.equal(step({ sel: 4 }, 'down').sel, 4);            // clamps at last
  assert.deepEqual(step({ sel: 0 }, 'enter'), { to: 'tour' });
  assert.deepEqual(step({ sel: 1 }, 'enter'), { to: 'tree' });
  assert.deepEqual(step({ sel: 2 }, 'enter'), { to: 'audit' });
  assert.deepEqual(step({ sel: 3 }, 'enter'), { to: 'ask' });
  assert.deepEqual(step({ sel: 4 }, 'enter'), { to: 'glossary' });
  assert.deepEqual(step(init(), 'q'), { done: true });
});
