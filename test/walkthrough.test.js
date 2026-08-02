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

test('buildTour teaches the whole tour one concept at a time, never cramming', async () => {
  const root = await mkdtemp(join(tmpdir(), 'walk-spaced-'));
  await writeFile(join(root, 'package.json'), '{"name":"x","scripts":{"dev":"node src/index.js"}}');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'console.log("hi");');
  const map = await buildMap(root);
  const tour = await buildTour(map, detectStack(map));

  // step 1: what the app is — no dependency/restaurant/glossary crammed in
  assert.equal(tour[0].title, 'What this app is');
  assert.match(tour[0].body, /Node\.js/);
  assert.match(tour[0].body, /\.js/);
  assert.doesNotMatch(tour[0].body, /dependency/i);
  assert.doesNotMatch(tour[0].body, /restaurant/);
  assert.doesNotMatch(tour[0].body, /glossary/i);

  // step 2: package.json — JSON first, then scripts, then dependencies, each its own idea
  assert.equal(tour[1].title, 'Your package.json');
  assert.match(tour[1].body, /JSON/);
  assert.match(tour[1].body, /ID card/);
  assert.match(tour[1].body, /scripts/i);
  assert.match(tour[1].body, /dependencies/i);
  assert.ok(tour[1].body.split('\n\n').length >= 4, 'ideas are separated by blank lines');

  // step 3: folders — src introduced as SOURCE with the restaurant metaphor; the
  // folder names travel as data (`folders`) so the renderer can lay them out, not
  // as a comma list inside the prose
  assert.equal(tour[2].title, 'These are your folders');
  assert.match(tour[2].body, /src stands for SOURCE/i);
  assert.match(tour[2].body, /kitchen/);
  assert.ok(Array.isArray(tour[2].folders), 'folders travel as data, not a comma wall');

  // the rest of the tour is short and spaced too
  assert.equal(tour[3].title, 'How it starts');
  assert.match(tour[3].body, /run/i);
  assert.ok(tour[3].body.split('\n\n').length >= 2, 'the run step has room to breathe');
  assert.match(tour[4].title, /A look inside/);
  assert.match(tour[5].title, /AI model/);
  assert.match(tour[5].body, /optional/);
  assert.match(tour[6].title, /watch/i);

  // the glossary is no longer crammed mid-blurb on any step
  for (const s of tour) assert.doesNotMatch(s.body || '', /appwalk glossary/);
});
