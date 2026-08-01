// test/tui.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTree } from '../src/tui.js';

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
