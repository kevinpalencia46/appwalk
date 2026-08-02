import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/home.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('home render shows the project name and 5 framed buttons (no mascot)', () => {
  const s = render(init(), { root: '/home/ren/great-pacific' });
  assert.match(s, /appwalk/);
  assert.match(s, /GREAT-PACIFIC/, 'project name is shown big');
  assert.match(s, /★/, 'the project name is shown as a phosphor header');
  assert.match(s, /Take the guided tour/);
  assert.match(s, /Explore your files/);
  assert.match(s, /Audit for safety/);
  assert.match(s, /Ask about a file/);
  assert.match(s, /Learn the words/);
  // every button carries a one-line description
  assert.match(s, /Walk your app step by step/);
  assert.match(s, /Browse every file & folder/);
  assert.match(s, /Find leaks, clutter & risks/);
  assert.match(s, /Explain any file plainly/);
  assert.match(s, /Plain-English definitions/);
  // each menu item is its own framed box — exactly 5 button tops
  const tops = strip(s).match(/┌─+┐/g) || [];
  assert.equal(tops.length, 5, 'five button frames render, not a list');
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

test('home step: 2D arrows move between buttons, enter routes, q quits', () => {
  let s = init();
  // down moves to the button below; right moves across
  assert.equal(step(s, 'down').r, 1);
  assert.equal(step(s, 'down').c, 0);
  assert.equal(step(s, 'right').r, 0);
  assert.equal(step(s, 'right').c, 1);
  // left wraps within a row
  assert.equal(step(s, 'left').c, 1);
  // down the second column, then the phantom slot lands on the last button
  assert.equal(step({ r: 0, c: 1 }, 'down').r, 1);
  assert.equal(step({ r: 0, c: 1 }, 'down').c, 1);
  assert.equal(step({ r: 1, c: 1 }, 'down').r, 2);
  assert.equal(step({ r: 1, c: 1 }, 'down').c, 0);
  // bottom wraps to top and up wraps to bottom
  assert.equal(step({ r: 2, c: 0 }, 'down').r, 0);
  assert.equal(step({ r: 2, c: 0 }, 'down').c, 0);
  assert.equal(step({ r: 0, c: 0 }, 'up').r, 2);
  assert.equal(step({ r: 0, c: 0 }, 'up').c, 0);
  // Enter activates the selected button
  assert.deepEqual(step({ r: 0, c: 0 }, 'enter'), { to: 'tour' });
  assert.deepEqual(step({ r: 0, c: 1 }, 'enter'), { to: 'tree' });
  assert.deepEqual(step({ r: 1, c: 0 }, 'enter'), { to: 'audit' });
  assert.deepEqual(step({ r: 1, c: 1 }, 'enter'), { to: 'ask' });
  assert.deepEqual(step({ r: 2, c: 0 }, 'enter'), { to: 'glossary' });
  assert.deepEqual(step(init(), 'q'), { done: true });
});
