// test/tui-viewer.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { init, render, step } from '../src/tui/viewer.js';

test('viewer renders the file header and refuses .env variants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-'));
  await writeFile(join(root, 'a.js'), 'const x = 1;');
  await writeFile(join(root, '.env'), 'SECRET=value');
  await writeFile(join(root, '.env.local'), 'SECRET=value');
  await writeFile(join(root, 'foo.env'), 'SECRET=value');
  const map = await buildMap(root);
  const js = map.flat.find((n) => n.name === 'a.js');
  const s = render(init({ file: js.path, mode: 'view' }), { root, map });
  assert.match(s, /a\.js/);
  const env = init({ file: join(root, '.env'), mode: 'view' });
  assert.match(render(env, { root, map }), /location only/);
  // every dotenv variant is refused, not just the exact '.env' basename
  assert.match(render(init({ file: join(root, '.env.local'), mode: 'view' }), { root, map }), /location only/);
  assert.match(render(init({ file: join(root, '.env.production'), mode: 'view' }), { root, map }), /location only/);
  // a file that merely ends in .env is a normal file — foo.env is viewable
  assert.doesNotMatch(render(init({ file: join(root, 'foo.env'), mode: 'view' }), { root, map }), /location only/);
});
test('viewer step scrolls, clamps at top/bottom, and backs out to home', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-step-'));
  const file = join(root, 'a.js');
  await writeFile(file, '1\n2\n3\n4\n5');
  let s = init({ file, mode: 'view', line: 0 });
  s = step(s, 'down');
  assert.equal(s.line, 1);
  // keep scrolling past EOF: line must clamp at totalLines - 1 = 4
  for (let i = 0; i < 6; i++) s = step(s, 'down');
  assert.equal(s.line, 4);
  s = step(s, 'up');
  assert.equal(s.line, 3);
  s = step({ ...s, line: 0 }, 'up');
  assert.equal(s.line, 0); // up clamps at 0
  assert.deepEqual(step(s, 'enter'), { to: 'home' });
});
test('viewer backs out to the caller, not always home', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-back-'));
  const file = join(root, 'a.js');
  await writeFile(file, 'x');
  // tree → viewer, then Enter: returns to tree
  assert.deepEqual(step(init({ file, mode: 'view', back: 'tree' }), 'enter'), { to: 'tree' });
  // tour → viewer, then q: returns to tour
  assert.deepEqual(step(init({ file, mode: 'view', back: 'tour' }), 'q'), { to: 'tour' });
  // the ask flow (no back): falls back to home
  assert.deepEqual(step(init({ file, mode: 'view' }), 'enter'), { to: 'home' });
});
test('viewer input mode lists project files on the left', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-in-'));
  await writeFile(join(root, 'a.js'), 'const a = 1;');
  await writeFile(join(root, 'b.js'), 'const b = 2;');
  const map = await buildMap(root);
  const s = render(init({ mode: 'input' }), { root, map });
  assert.match(s, /Ask about a file/);
  assert.match(s, /a\.js/);
  assert.match(s, /b\.js/);
  // the first render invites, not just lists
  assert.match(s, /open up a file to view your code and a brief explanation/, 'the empty state invites');
  // once the user starts typing, the invite steps aside
  const typed = render(step(init({ mode: 'input' }), 'a', { root, map }), { root, map });
  assert.doesNotMatch(typed, /open up a file/, 'the invite hides once typing starts');
});
test('viewer input mode typing filters the list and Enter opens the top match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-filt-'));
  await writeFile(join(root, 'alice.js'), 'x');
  await writeFile(join(root, 'zebra.js'), 'y');
  const map = await buildMap(root);
  let st = init({ mode: 'input' });
  for (const ch of 'zebra') st = step(st, ch, { root, map });
  assert.equal(st.buf, 'zebra');
  const s = render(st, { root, map });
  assert.match(s, /zebra\.js/);
  assert.doesNotMatch(s, /alice\.js/);
  const opened = step(st, 'enter', { root, map });
  assert.equal(opened.mode, 'view');
  assert.ok(opened.file.endsWith('zebra.js'));
});
test('viewer input mode count shows the real total when the list is capped at 40', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-cap-'));
  for (let i = 0; i < 45; i++) await writeFile(join(root, `f${i}.js`), 'x');
  const map = await buildMap(root);
  const s = render(init({ mode: 'input' }), { root, map });
  assert.match(s, /showing first 40 of 45 files/);
  assert.doesNotMatch(s, /40 files/, 'must not present the capped count as the real total');
});
