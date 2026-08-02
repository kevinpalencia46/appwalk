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

test('tour render shows step N of total, the mascot, and a body', async () => {
  const data = await makeData();
  const s = render(init(), data);
  assert.match(s, /step 1 of/);
  assert.match(s, /•_•/, 'mascot appears at the top of each tour step');
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

test('tour step: t routes to the try screen with an appwalk-chosen command', async () => {
  const data = await makeData();
  // step 0 of a node tour is tagged 'peek' → cat package.json, back to the tour
  const res = step(init(), 't', data, data.tour);
  assert.equal(res.to, 'try');
  assert.equal(res.params.cmd, 'cat');
  assert.deepEqual(res.params.args, ['package.json']);
  assert.equal(res.params.back, 'tour');
  // the step inside a code file suggests the run demo (a real program executing)
  const codeStep = data.tour.findIndex((t) => t.tags?.includes('run'));
  assert.ok(codeStep >= 0, 'a run-tagged step exists');
  const res2 = step({ step: codeStep }, 't', data, data.tour);
  assert.equal(res2.to, 'try');
  assert.equal(res2.params.cmd, 'node');
  assert.deepEqual(res2.params.args, ['-e', 'console.log(1+1)']);
});

test('tour render advertises the t try-it key when the stack has something to run', async () => {
  const data = await makeData();
  const s = render(init(), data);
  assert.match(s, /t = try it|Press .t. to try it|try it/, 'a try-it hint is visible');
});

test('tour render sanitizes escape sequences out of the step body', async () => {
  const evil = 'legit start\x1b[2J\x1b[?25l tail';
  const s = render(init(), { tour: [{ title: 't', body: evil, files: [] }] });
  assert.ok(!s.includes('\x1b[2J'), 'clear-screen escape leaked into the tour body');
  assert.ok(!s.includes('\x1b[?25l'), 'cursor-hide escape leaked into the tour body');
  assert.ok(s.includes('legit start'));
  assert.ok(s.includes('tail'));
});
