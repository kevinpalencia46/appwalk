import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { detectStack, buildTour, printTour } from '../src/walkthrough.js';

test('detectStack finds a node app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'walk-'));
  await writeFile(join(root, 'package.json'), '{"name":"x","scripts":{"dev":"node src/index.js"}}');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'import express from "express"; app.listen(3000);');
  const map = await buildMap(root);
  const s = detectStack(map);
  assert.equal(s.type, 'node');
  assert.ok(s.runCmd);
});

test('detectStack falls back to unknown gracefully', async () => {
  const root = await mkdtemp(join(tmpdir(), 'walk-unk-'));
  await writeFile(join(root, 'random.txt'), 'hi');
  const map = await buildMap(root);
  assert.equal(detectStack(map).type, 'unknown');
});

test('buildTour returns a multi-step tour ending in "what to watch"', async () => {
  const root = await mkdtemp(join(tmpdir(), 'walk-tour-'));
  await writeFile(join(root, 'package.json'), '{"name":"x","scripts":{"dev":"node src/index.js"}}');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'import express from "express"; app.listen(3000);');
  await writeFile(join(root, '.env'), 'API_KEY=secret');
  const map = await buildMap(root);
  const tour = await buildTour(map, detectStack(map));
  assert.ok(tour.length >= 4);
  assert.match(tour[tour.length - 1].title, /watch/i);
  assert.ok(printTour(tour).length > 50);
});
