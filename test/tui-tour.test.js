// test/tui-tour.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { detectStack, buildTour } from '../src/walkthrough.js';
import { init, render, step } from '../src/tui/tour.js';

async function makeData() {
  const root = await mkdtemp(join(tmpdir(), 'tour-ui-'));
  await writeFile(join(root, 'package.json'), '{"name":"x","scripts":{"dev":"node src/index.js"}}');
  await writeFile(join(root, 'index.js'), 'console.log("hi");');
  const map = await buildMap(root);
  const stack = detectStack(map);
  return { root, map, stack, tour: await buildTour(map, stack) };
}

test('tour render shows step N of total and a body', async () => {
  const data = await makeData();
  const s = render(init(), data);
  assert.match(s, /step 1 of/);
  assert.ok(s.length > 40);
});
test('tour step advances, opens a file, and finishes on the last step', async () => {
  const data = await makeData();
  const tour = await (await import('../src/walkthrough.js')).buildTour(data.map, data.stack);
  let s = init();
  assert.equal(step(s, 'enter', data, tour).step, 1);
  assert.deepEqual(step({ step: 1 }, 'o', data, tour), { to: 'viewer', params: { file: tour[1].files[0], back: 'tour' } });
  // finishing the last step lands back on home with the celebrate banner, not a quit
  assert.deepEqual(step({ step: tour.length - 1 }, 'enter', data, tour), { to: 'home', params: { celebrate: true } });
});

test('tour step: g routes to the glossary screen', async () => {
  const data = await makeData();
  assert.deepEqual(step(init(), 'g', data, data.tour), { to: 'glossary' });
});

test('tour render sanitizes escape sequences out of the step body', async () => {
  const evil = 'legit start\x1b[2J\x1b[?25l tail';
  const s = render(init(), { tour: [{ title: 't', body: evil, files: [] }] });
  assert.ok(!s.includes('\x1b[2J'), 'clear-screen escape leaked into the tour body');
  assert.ok(!s.includes('\x1b[?25l'), 'cursor-hide escape leaked into the tour body');
  assert.ok(s.includes('legit start'));
  assert.ok(s.includes('tail'));
});
