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
