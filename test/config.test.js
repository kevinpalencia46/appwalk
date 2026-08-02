import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { scanConfigFiles } from '../src/config.js';

// ESM-safe dirname (no require): a bare "a.js" stays in root, "handlers/a.js" nests.
const dirname = (p) => p.split('/').slice(0, -1).join('/') || '.';
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'cfg-'));
  for (const [p, txt] of Object.entries(files)) {
    await mkdir(join(root, dirname(p)), { recursive: true });
    await writeFile(join(root, p), txt);
  }
  return root;
}
const has = (files, name) => files.find((f) => f.name === name);
const setting = (file, key) => file.settings.find((s) => s.key === key);

test('package.json is first and pulls the real settings with why + alternatives', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'x', type: 'module', scripts: { dev: 'vite' }, dependencies: { react: '^18' } }),
    'index.js': "import React from 'react';",
  });
  const { files } = await scanConfigFiles(await buildMap(root));
  assert.equal(files[0].kind, 'package.json', 'package.json sorts first');
  const pkg = has(files, 'package.json');
  assert.equal(setting(pkg, 'type').value, 'module');
  assert.match(setting(pkg, 'type').why, /import/i);
  assert.ok(setting(pkg, 'type').alternatives.length > 0);
  assert.match(setting(pkg, 'scripts').value, /dev/);
  assert.ok(setting(pkg, 'dependencies').value.includes('react'));
});

test('tsconfig strict is explained', async () => {
  const root = await fixture({ 'package.json': '{}', 'tsconfig.json': '{"compilerOptions":{"strict":true,"target":"ES2022"}}' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const ts = has(files, 'tsconfig.json');
  assert.equal(setting(ts, 'strict').value, 'true');
  assert.match(setting(ts, 'strict').why, /catch/i);
});

test('.env card is location-only — its value never appears anywhere in the output', async () => {
  const root = await fixture({ '.env': 'SUPER_SECRET_VALUE_123=abc', 'package.json': '{}' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const env = has(files, '.env');
  assert.ok(env, '.env appears as a card');
  const blob = JSON.stringify(files);
  assert.doesNotMatch(blob, /SUPER_SECRET_VALUE_123/, 'the .env value must never leak into config output');
  assert.doesNotMatch(blob, /abc/, 'even a short value string must not leak');
  assert.match(env.note, /never/i);
});

test('unknown config file gets a generic card, never skipped, never crashes', async () => {
  const root = await fixture({ 'package.json': '{}', 'weird.yml': 'key: value\n' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const w = has(files, 'weird.yml');
  assert.ok(w, 'unknown config is still shown');
  assert.equal(w.kind, 'generic');
  assert.match(w.what, /settings file/i);
});

test('malformed package.json renders a couldn-t-parse card, no throw', async () => {
  const root = await fixture({ 'package.json': '{ oops not json', 'index.js': '// hi' });
  const { files } = await scanConfigFiles(await buildMap(root));
  const pkg = has(files, 'package.json');
  assert.ok(pkg, 'the card still exists');
  assert.match(pkg.note, /couldn.t parse/i);
});

test('.gitignore card appears even though walk() skips dotfiles', async () => {
  const root = await fixture({ 'package.json': '{}', '.gitignore': 'node_modules\n.env\n' });
  const { files } = await scanConfigFiles(await buildMap(root));
  assert.ok(has(files, '.gitignore'), 'gitignore probed directly');
});
