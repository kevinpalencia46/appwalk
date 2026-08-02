import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { scanConfigFiles, suggestFiling } from '../src/config.js';
import { init, render, step } from '../src/tui/config.js';

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

async function data(rootFiles, { hasEnv = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tuicfg-'));
  for (const [p, txt] of Object.entries(rootFiles)) {
    await mkdir(join(root, p.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    await writeFile(join(root, p), txt);
  }
  if (hasEnv) await writeFile(join(root, '.env'), 'SECRET_TOKEN=hunter2');
  const map = await buildMap(root);
  return { files: (await scanConfigFiles(map)).files, filing: await suggestFiling(map) };
}

test('view 1 renders the config file list with the package.json first', async () => {
  const config = await data({ 'package.json': '{"type":"module"}', 'tsconfig.json': '{"compilerOptions":{}}', 'index.js': '// hi' });
  const s = strip(render(init(), { config }));
  assert.match(s, /settings/i);
  assert.match(s, /package\.json/);
  assert.match(s, /tsconfig\.json/);
  assert.ok(s.indexOf('package.json') < s.indexOf('tsconfig.json'), 'package.json sorts first');
});

test('Enter opens a config detail; back returns to the list', async () => {
  const config = await data({ 'package.json': '{"type":"module"}' });
  let s = init();
  s = step(s, 'enter', { config });
  assert.ok(s.detail, 'enter opens the selected file detail');
  assert.equal(s.detail.name, 'package.json');
  const detail = strip(render(s, { config }));
  assert.match(detail, /type/);
  assert.match(detail, /module/);
  assert.match(detail, /you could also/i);
  s = step(s, 'left', { config });
  assert.equal(s.detail, null, 'back from the detail returns to the list');
});

test('the .env card never shows its value, even in detail', async () => {
  const config = await data({ 'package.json': '{}' }, { hasEnv: true });
  const list = strip(render(init(), { config }));
  assert.match(list, /\.env/);
  assert.doesNotMatch(list, /hunter2/, 'no value in the list');
  const s = step({ ...init(), cursor: 1 }, 'enter', { config }); // 0=package.json, 1=.env
  const detail = strip(render(s, { config }));
  assert.doesNotMatch(detail, /hunter2/, 'no value in the detail either');
});

test('view 2 renders filing groups, tips, and a clutter pointer', async () => {
  const config = await data({
    'package.json': '{"main":"index.js"}',
    'index.js': "import a from './a.js'; import b from './b.js'; import c from './c.js';",
    'a.js': 'export default () => {};', 'b.js': 'export default () => {};', 'c.js': 'export default () => {};',
  });
  let s = step(init(), '2', { config });
  assert.equal(s.view, 2, '2 switches to Clean it up');
  const out = strip(render(s, { config, findings: [{ file: 'x', kind: 'bak', category: 'clutter' }] }));
  assert.match(out, /clean/i);
  assert.match(out, /routes\//, 'the role-grouped suggestion renders');
  assert.match(out, /clutter/i, 'the clutter pointer renders when findings exist');
  // switching back works
  assert.equal(step(s, '1', { config }).view, 1);
});

test('q backs out; the screen degrades gracefully with no config data', () => {
  assert.deepEqual(step(init(), 'q', {}), { to: 'home' });
  assert.deepEqual(step(init({ back: 'tree' }), 'q', {}), { to: 'tree' });
  const s = strip(render(init(), {}));
  assert.match(s, /no config/i, 'no config data renders a friendly empty state');
});
