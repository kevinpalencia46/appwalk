import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/home.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('home render shows the project name and 7 framed buttons (no mascot)', () => {
  const s = render(init(), { root: '/home/ren/great-pacific' });
  assert.match(s, /appwalk/);
  assert.match(s, /GREAT-PACIFIC/);
  assert.match(s, /Take the guided tour/);
  assert.match(s, /Explore your files/);
  assert.match(s, /Audit for safety/);
  assert.match(s, /Ask about a file/);
  assert.match(s, /Learn the words/);
  assert.match(s, /See how it fits together/);
  assert.match(s, /Your setup/, 'the 7th button renders');
  assert.match(s, /Walk your app step by step/);
  assert.match(s, /Map how the pieces connect/);
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

test('home step: 2-wide 4-row grid — 2D arrows, lone 7th clamps, no phantom slot', () => {
  let s = init();
  s = step(s, 'right');
  assert.equal(s.c, 1, 'right moves across row 0');
  assert.equal(step(s, 'right').c, 0, 'right wraps within a row');
  assert.equal(step(s, 'down').r, 1, 'down moves a row');
  assert.equal(step({ r: 1, c: 1 }, 'down').r, 2, 'down the second column');
  assert.equal(step({ r: 2, c: 1 }, 'down').r, 3, 'down from the flow button to the last row');
  assert.equal(step({ r: 2, c: 1 }, 'down').c, 0, '…lands on the lone 7th, skipping the empty cell');
  assert.equal(step({ r: 3, c: 0 }, 'down').r, 0, 'bottom wraps to top');
  assert.equal(step({ r: 0, c: 0 }, 'up').r, 3, 'top wraps to bottom');
  assert.equal(step({ r: 3, c: 0 }, 'right').c, 0, 'right past the empty cell wraps in place');
  assert.deepEqual(step({ r: 0, c: 0 }, 'enter'), { to: 'tour' });
  assert.deepEqual(step({ r: 0, c: 1 }, 'enter'), { to: 'tree' });
  assert.deepEqual(step({ r: 1, c: 0 }, 'enter'), { to: 'audit' });
  assert.deepEqual(step({ r: 1, c: 1 }, 'enter'), { to: 'ask' });
  assert.deepEqual(step({ r: 2, c: 0 }, 'enter'), { to: 'glossary' });
  assert.deepEqual(step({ r: 2, c: 1 }, 'enter'), { to: 'flow' });
  assert.deepEqual(step({ r: 3, c: 0 }, 'enter'), { to: 'config' });
  assert.deepEqual(step(init(), 'q'), { done: true });
});
