// test/tui-tour.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { detectStack, buildTour, MODEL_OPTIONS } from '../src/walkthrough.js';
import { init, render, step, hints } from '../src/tui/tour.js';

async function makeData() {
  const root = await mkdtemp(join(tmpdir(), 'tour-ui-'));
  await writeFile(join(root, 'package.json'), '{"name":"x","scripts":{"dev":"node src/index.js"}}');
  await writeFile(join(root, 'index.js'), 'console.log("hi");');
  const map = await buildMap(root);
  const stack = detectStack(map);
  return { root, map, stack, tour: await buildTour(map, stack) };
}

test('tour render shows step N of total and a body (no mascot)', async () => {
  const data = await makeData();
  const s = render(init(), data);
  assert.match(s, /step 1 of/);
  assert.ok(s.length > 40);
  assert.ok(!s.includes('o   o'), 'the duck mascot is stripped from tour steps');
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
  // step 1 of a node tour is tagged 'peek' → cat package.json, back to the tour
  const res = step({ step: 1 }, 't', data, data.tour);
  assert.equal(res.to, 'try');
  assert.equal(res.params.cmd, 'cat');
  assert.deepEqual(res.params.args, ['package.json']);
  assert.equal(res.params.back, 'tour');
  assert.equal(res.params.tourStep, 1, 'the try screen remembers which tour step it came from');
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
  // step 1 (Your package.json) is the peek step → advertises t
  const s = render({ step: 1 }, data);
  assert.match(s, /Press .+ to try it/, 'a try-it hint is visible');
  assert.match(s, /type a command of your own/, 'the try hint calmly invites typing your own');
});

test('tour step: ← or b returns to the previous step, clamped at 0', async () => {
  const data = await makeData();
  assert.equal(step({ step: 2 }, 'b', data, data.tour).step, 1);
  assert.equal(step({ step: 2 }, 'left', data, data.tour).step, 1);
  assert.equal(step({ step: 0 }, 'b', data, data.tour).step, 0, 'clamped at the first step');
  assert.equal(step({ step: 0 }, 'left', data, data.tour).step, 0);
  // the model picker step also backs out cleanly
  const modelStep = data.tour.findIndex((s) => s.models);
  assert.equal(step({ step: modelStep }, 'b', data, data.tour).step, modelStep - 1);
  assert.equal(step({ step: modelStep }, 'left', data, data.tour).step, modelStep - 1);
  // returning from the try box resumes at the step it came from
  assert.equal(init({ resume: 2 }).step, 2);
  assert.equal(init({}).step, 0);
});

test('tour render ends a step with a calm glossary invitation, not a mid-blurb list', async () => {
  const data = await makeData();
  const s = render(init(), data);
  assert.match(s, /Any word you don't know — press g/);
  assert.doesNotMatch(s, /run `appwalk glossary`/, 'the old mid-blurb glossary line is gone');
  assert.doesNotMatch(s, /dependency/, 'step 1 no longer crams the word dependency');
});

test('tour model picker: renders 4 rows, arrows move, Enter expands, Enter again advances', async () => {
  const data = await makeData();
  const t = data.tour.findIndex((s) => s.models);
  assert.ok(t >= 0, 'the choose-your-model step exists in the tour');
  const start = { step: t };
  assert.match(hints(start, data), /choose a model/, 'the picker hints describe the picker');
  const s = render(start, data);
  for (const m of MODEL_OPTIONS) assert.match(s, new RegExp(m.label.replace(/[()]/g, '\\$&')), `row shows ${m.label}`);
  assert.match(s, /cheap & fast/, 'cost is shown per row');
  assert.match(s, /free · private · offline/, 'local cost is shown per row');
  assert.match(s, /no key needed/, 'claude-code cost is shown per row');
  assert.match(s, /Press ENTER to expand/, 'the hint line explains the first press');
  // arrows move the selection and clamp at the ends
  assert.equal(step(start, 'down', data, data.tour).modelSel, 1);
  assert.equal(step({ step: t, modelSel: 3 }, 'down', data, data.tour).modelSel, 3);
  assert.equal(step({ step: t, modelSel: 1 }, 'up', data, data.tour).modelSel, 0);
  // first Enter expands the detail on the selected row, staying on the step
  const exp = step(start, 'enter', data, data.tour);
  assert.equal(exp.modelDetail, 0, 'detail opens on the selected model');
  assert.equal(exp.step, t);
  assert.match(render(exp, data), /setup:/, 'the expanded setup detail renders');
  assert.match(render(exp, data), /AI_PROVIDER|Ollama|claude-code/, 'real setup facts render');
  // moving clears the expanded detail
  assert.equal(step(exp, 'down', data, data.tour).modelDetail, null);
  // second Enter (detail open) advances the tour
  const adv = step(exp, 'enter', data, data.tour);
  assert.equal(adv.step, t + 1);
});

test('tour render sanitizes escape sequences out of the step body', async () => {
  const evil = 'legit start\x1b[2J\x1b[?25l tail';
  const s = render(init(), { tour: [{ title: 't', body: evil, files: [] }] });
  assert.ok(!s.includes('\x1b[2J'), 'clear-screen escape leaked into the tour body');
  assert.ok(!s.includes('\x1b[?25l'), 'cursor-hide escape leaked into the tour body');
  assert.ok(s.includes('legit start'));
  assert.ok(s.includes('tail'));
});

test('tour folders step renders one folder per line (not a comma wall)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tour-fold-'));
  await writeFile(join(root, 'package.json'), '{"name":"x"}');
  for (const n of ['src', 'public', 'assets']) {
    await mkdir(join(root, n), { recursive: true });
    await writeFile(join(root, n, 'keep.txt'), 'x');
  }
  const map = await buildMap(root);
  const stack = detectStack(map);
  const tour = await buildTour(map, stack);
  const t = tour.find((s) => s.title === 'These are your folders');
  assert.deepEqual([...t.folders].sort(), ['assets', 'public', 'src'], 'folders travel as data, not prose');
  assert.doesNotMatch(t.body, /src, public, assets/, 'no comma list in the prose body');
  const s = render({ step: tour.indexOf(t) }, { root, map, stack, tour });
  const oneDot = s.split('\n').filter((l) => (l.match(/·/g) || []).length === 1);
  assert.ok(oneDot.length >= 3, 'three folders each sit on their own line');
});

test('tour folders step wraps 10+ folders into a 2-column grid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tour-grid-'));
  await writeFile(join(root, 'package.json'), '{"name":"x"}');
  for (const n of ['src', 'public', 'lib', 'components', 'pages', 'utils', 'assets', 'hooks', 'styles', 'scripts']) {
    await mkdir(join(root, n), { recursive: true });
    await writeFile(join(root, n, 'keep.txt'), 'x');
  }
  const map = await buildMap(root);
  const stack = detectStack(map);
  const tour = await buildTour(map, stack);
  const t = tour.find((s) => s.title === 'These are your folders');
  assert.ok(t.folders.length === 10);
  const s = render({ step: tour.indexOf(t) }, { root, map, stack, tour });
  const twoDot = s.split('\n').filter((l) => (l.match(/·/g) || []).length === 2);
  assert.ok(twoDot.length >= 5, `10 folders wrap into ~5 two-column rows, got ${twoDot.length}`);
});

test('tour model picker keeps breathing room between cost / good-at / setup', async () => {
  const data = await makeData();
  const t = data.tour.findIndex((s) => s.models);
  const s = render({ step: t, modelSel: 0, modelDetail: 0 }, data);
  const strip = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
  // blank content rows look like "│   │" once ANSI is stripped
  const blankRows = s.split('\n').filter((l) => /^│\s+│$/.test(strip(l)));
  assert.ok(blankRows.length >= 2, 'cost / good-at / setup sections are separated by blank rows');
  // and the sections themselves read in order: cost, then good at, then setup
  const text = strip(s);
  assert.ok(text.indexOf('cheap & fast') < text.indexOf('good at:'), 'cost comes before good-at');
  assert.ok(text.indexOf('good at:') < text.indexOf('setup:'), 'good-at comes before setup');
});
