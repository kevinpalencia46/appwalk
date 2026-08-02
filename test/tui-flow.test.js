// test/tui-flow.test.js — the flow map screen (src/tui/flow.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { detectStack } from '../src/walkthrough.js';
import { buildFlow } from '../src/flow.js';
import { init, render, step, MAX_DEPTH } from '../src/tui/flow.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tflow-'));
  await mkdir(join(root, 'api'), { recursive: true });
  await mkdir(join(root, 'handlers'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"main":"index.js"}');
  await writeFile(join(root, 'index.js'), [
    "import express from 'express';",
    "import routes from './api/routes.js';",
    'const app = express();',
    "app.use('/api', routes);",
    "app.get('/ping', './handlers/ping.js');",
  ].join('\n'));
  await writeFile(join(root, 'api', 'routes.js'), [
    "const db = require('../db.js');",
    "const router = require('express').Router();",
    "router.get('/users', (req, res) => db.query());",
  ].join('\n'));
  await writeFile(join(root, 'db.js'), 'module.exports.query = () => {};');
  await writeFile(join(root, 'handlers', 'ping.js'), 'export default (req, res) => res.send("pong");');
  const map = await buildMap(root);
  const stack = detectStack(map);
  return { root, map, stack };
}

test('flow render shows depth-1 backbone with collapsed "+N more", cursor on the entry', async () => {
  const { map, stack } = await fixture();
  const data = { flowCache: { 1: await buildFlow(map, stack, { depth: 1 }) } };
  const s = render(init(), data);
  assert.match(s, /How it fits together/);
  assert.match(s, /index\.js/);
  assert.match(s, /api\/routes\.js/);
  assert.match(s, /\(\+1 more\)/, 'the hidden db.js appears as +1 more on routes.js');
  assert.match(s, /handlers\/ping\.js/);
  assert.doesNotMatch(s, /db\.js/, 'depth-1 render hides the depth-2 db.js node');
  assert.equal((s.match(/\x1b\[7m/g) || []).length, 1, 'exactly one line is inverted (the cursor row)');
});

test('flow render at depth 2 reveals the deeper node and clears "+N more"', async () => {
  const { map, stack } = await fixture();
  const data = { flowCache: { 1: await buildFlow(map, stack, { depth: 1 }), 2: await buildFlow(map, stack, { depth: 2 }) } };
  const s = render(init({ depth: 2 }), data);
  assert.match(s, /db\.js/, 'depth 2 expands the db.js node');
  assert.doesNotMatch(s, /\(\+\d+ more\)/, 'nothing collapsed at depth 2');
  // the footer reports the depth
  assert.match(s, /depth 2/);
});

test('flow render degrades gracefully when there is no entry point', () => {
  const s = render(init(), { flowCache: { 1: { start: null, nodes: [], edges: [], order: [] } } });
  assert.match(s, /No entry point found/);
});

test('flow step: arrows move the cursor, Enter opens the node in the viewer', async () => {
  const { root, map, stack } = await fixture();
  const data = { flowCache: { 1: await buildFlow(map, stack, { depth: 1 }), 2: await buildFlow(map, stack, { depth: 2 }) } };

  let s = init();
  assert.equal(s.cursor, 0);
  s = step(s, 'down', data);
  assert.equal(s.cursor, 1, 'down moves to the next node');
  s = step(s, 'up', data);
  assert.equal(s.cursor, 0);
  s = step(s, 'up', data);
  assert.equal(s.cursor, 0, 'up clamps at the top');

  // cursor 1 is api/routes.js — Enter opens it in the viewer, back to flow
  const opened = step({ ...init(), cursor: 1 }, 'enter', data);
  assert.deepEqual(opened, { to: 'viewer', params: { file: join(root, 'api', 'routes.js'), mode: 'view', back: 'flow' } });
});

test('flow step: +/− changes depth (clamped) and q goes back home', async () => {
  const { map, stack } = await fixture();
  const data = { flowCache: { 1: await buildFlow(map, stack, { depth: 1 }), 2: await buildFlow(map, stack, { depth: 2 }) } };

  let s = init();
  assert.equal(s.depth, 1);
  s = step(s, '+', data);
  assert.equal(s.depth, 2);
  s = step(s, '-', data);
  assert.equal(s.depth, 1);
  s = step(s, '-', data);
  assert.equal(s.depth, 1, 'depth never drops below 1');

  const deep = step({ depth: MAX_DEPTH }, '+', data);
  assert.equal(deep.depth, MAX_DEPTH, 'depth caps at MAX_DEPTH');

  assert.deepEqual(step(init(), 'q', data), { to: 'home' }, 'q backs out to home (the launcher that opened it)');
  assert.deepEqual(step(init({ back: 'tree' }), 'q', data), { to: 'tree' });
});

test('flow step: +/− clamps a stale cursor to the new depth order length', async () => {
  const { map, stack } = await fixture();
  const data = { flowCache: { 1: await buildFlow(map, stack, { depth: 1 }), 2: await buildFlow(map, stack, { depth: 2 }) } };
  // depth 2 maps 4 nodes (index, routes, db, ping); depth 1 maps 3 (index, routes, ping).

  // A cursor on the last depth-2 row (index 3) survives a shrink to depth 1, where
  // the last valid row is index 2 — it must clamp, not stay frozen off the tree.
  const shrunk = step({ ...init({ depth: 2 }), cursor: 3 }, '-', data);
  assert.equal(shrunk.depth, 1);
  assert.equal(shrunk.cursor, 2, 'cursor clamps to the last row of the smaller depth-1 tree');

  // Growing the depth keeps a cursor valid, but a cursor past the new length (a
  // stale state) still clamps rather than pointing at nothing.
  const grown = step({ ...init({ depth: 1 }), cursor: 9 }, '+', data);
  assert.equal(grown.depth, 2);
  assert.equal(grown.cursor, 3, 'cursor clamps to the last row of the depth-2 tree');
});
