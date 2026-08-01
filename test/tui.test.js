// test/tui.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTree, step } from '../src/tui.js';

test('renderTree draws entries with cursor and entry marker', () => {
  const map = {
    flat: [
      { name: 'package.json', path: '/x/package.json', lang: 'json', size: 100, dir: '.', entry: true },
      { name: 'index.js', path: '/x/src/index.js', lang: 'js', size: 200, dir: 'src', entry: true },
    ],
    entryPoints: [],
  };
  const out = renderTree(map, 0, 100);
  assert.match(out, /▶/);                 // entry marker present
  assert.match(out, /package\.json/);
  assert.ok(out.includes('\x1b[7m'));      // reverse-video on the cursor row
  assert.match(out, /100 B/);              // size present
});

test('renderTree respects width and shows .env location hint', () => {
  const map = { flat: [{ name: '.env', path: '/x/.env', lang: 'env', size: 5, dir: '.', entry: false }], entryPoints: [] };
  const out = renderTree(map, 0, 60);
  assert.match(out, /\.env/);
  assert.match(out, /location only/i);
});

const mkState = (cursor, flat = [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }, { name: 'c', path: '/c' }]) =>
  ({ mode: 'map', cursor, detailNode: null, flat });

test('step: map-mode arrows move and clamp at bounds', () => {
  assert.equal(step(mkState(0), 'up').cursor, 0);      // already at top
  assert.equal(step(mkState(0), 'down').cursor, 1);
  assert.equal(step(mkState(2), 'down').cursor, 2);    // already at bottom
  assert.equal(step(mkState(2), 'up').cursor, 1);
});

test('step: Enter in map-mode opens the node under the cursor', () => {
  const flat = [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }];
  const next = step(mkState(1, flat), 'enter');
  assert.equal(next.mode, 'detail');
  assert.equal(next.detailNode, flat[1]);
  assert.equal(next.cursor, 1);
});

test('step: Enter or q in detail-mode returns to map', () => {
  const flat = [{ name: 'a', path: '/a' }];
  const detailState = { mode: 'detail', cursor: 0, detailNode: flat[0], flat };
  assert.deepEqual(step(detailState, 'enter'), { mode: 'map', cursor: 0, detailNode: null, flat });
  assert.deepEqual(step(detailState, 'quit'), { mode: 'map', cursor: 0, detailNode: null, flat });
});

test('step: q in map-mode quits with a done marker', () => {
  assert.deepEqual(step(mkState(0), 'quit'), { done: true });
});
