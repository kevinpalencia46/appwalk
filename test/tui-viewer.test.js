// test/tui-viewer.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { init, render, step } from '../src/tui/viewer.js';

test('viewer renders the file header and refuses .env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'view-'));
  await writeFile(join(root, 'a.js'), 'const x = 1;');
  await writeFile(join(root, '.env'), 'SECRET=value');
  const map = await buildMap(root);
  const js = map.flat.find((n) => n.name === 'a.js');
  const s = render(init({ file: js.path, mode: 'view' }), { root, map });
  assert.match(s, /a\.js/);
  const env = init({ file: join(root, '.env'), mode: 'view' });
  assert.match(render(env, { root, map }), /location only/);
});
test('viewer step scrolls and backs out to home', () => {
  let s = init({ file: '/x/a.js', mode: 'view', line: 0 });
  s = step(s, 'down');
  assert.equal(s.line, 1);
  assert.deepEqual(step(s, 'enter'), { to: 'home' });
});
