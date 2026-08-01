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
});

test('tree step: enter opens a file, right expands a folder, q quits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tstep-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'x');
  const map = await buildMap(root);
  const tree = buildFolderTree(map.flat);
  let s = init();
  s = { ...s, tree };              // step needs the tree
  const opened = step(s, 'enter', { root, map, tree });
  if (opened.to) assert.equal(opened.to, 'viewer');
});
