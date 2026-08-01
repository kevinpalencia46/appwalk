// test/tree.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';

test('buildMap finds entry points and sizes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tree-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"name":"x","scripts":{"dev":"node src/index.js"}}');
  await writeFile(join(root, 'src', 'index.js'), 'import express from "express"; app.listen(3000);');
  await writeFile(join(root, 'README.md'), '# x');
  const map = await buildMap(root);
  assert.ok(map.flat.some((n) => n.path.endsWith('package.json')));
  assert.ok(map.flat.some((n) => n.path.endsWith('src/index.js')));
  const entryNames = map.entryPoints.map((n) => n.name);
  assert.ok(entryNames.includes('package.json'));
  assert.ok(entryNames.includes('index.js'));
  const pkg = map.flat.find((n) => n.name === 'package.json');
  assert.ok(pkg.size > 0);
});

test('unknown/empty dir has no entries and empty flat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tree-empty-'));
  const map = await buildMap(root);
  assert.equal(map.flat.length, 0);
  assert.equal(map.entryPoints.length, 0);
});
