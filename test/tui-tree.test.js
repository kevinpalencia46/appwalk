// test/tui-tree.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { buildFolderTree, init, render, step } from '../src/tui/tree.js';

test('buildFolderTree nests folders and files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ftree-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'x');
  await writeFile(join(root, 'package.json'), '{}');
  const map = await buildMap(root);
  const tree = buildFolderTree(map.flat);
  const top = tree.map((n) => n.name).sort();
  assert.deepEqual(top, ['package.json', 'src']);
  const src = tree.find((n) => n.name === 'src');
  assert.ok(src.type === 'dir' && src.children.length === 1);
});

test('tree render shows folders, entry points, and the .env location row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tview-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'import express from "express";');
  await writeFile(join(root, 'package.json'), '{"name":"x"}');
  await writeFile(join(root, '.env'), 'SECRET=value');
  const map = await buildMap(root);
  const st = init();
  st.expanded.add('src');
  const s = render(st, { root, map });
  assert.match(s, /src/);
  assert.match(s, /index\.js/);
  assert.match(s, /location only/);
  // the cursor row is rendered inverted — exactly one \x1b[7m marker
  assert.equal((s.match(/\x1b\[7m/g) || []).length, 1);
});

test('tree step: enter opens a file, right expands a folder, q quits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tstep-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'x');
  await writeFile(join(root, 'package.json'), '{}');
  const map = await buildMap(root);
  const tree = buildFolderTree(map.flat);
  let s = init();
  s = { ...s, tree };              // step needs the tree

  // (a) cursor starts on the root package.json (a file) → enter opens it in the viewer
  assert.deepEqual(step(s, 'enter', { root, map, tree }), { to: 'viewer', params: { file: join(root, 'package.json'), mode: 'view' } });

  // (b) move onto the src dir, right expands it
  s = step(s, 'down', { root, map, tree });
  s = step(s, 'right', { root, map, tree });
  assert.ok(s.expanded.has('src'));

  // (c) q quits
  assert.deepEqual(step(s, 'q', { root, map, tree }), { done: true });
});
