import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'appwalk.js');
const run = async (root, args) => JSON.parse((await exec('node', [BIN, ...args], { cwd: root })).stdout);

test('stack --json reports the app type + entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jstack-'));
  await writeFile(join(root, 'package.json'), '{"main":"index.js"}');
  await writeFile(join(root, 'index.js'), '// hi');
  const s = await run(root, ['stack', '--json']);
  assert.equal(s.type, 'node');
  assert.equal(s.entry, 'package.json');
});

test('tree --json lists files with roles + entry flags, never .env values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jtree-'));
  await writeFile(join(root, 'package.json'), '{}');
  await writeFile(join(root, 'index.js'), '// hi');
  await writeFile(join(root, '.env'), 'SECRET=hunter2');
  const t = await run(root, ['tree', '--json']);
  assert.ok(t.files.some((f) => f.name === 'index.js'));
  assert.ok(t.files.some((f) => f.entry), 'the entry file is flagged');
  assert.equal(t.hasEnv, true);
  assert.ok(!JSON.stringify(t).includes('hunter2'), '.env value never leaks');
});

test('flow --json returns nodes/edges/order with a resolved start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jflow-'));
  await writeFile(join(root, 'package.json'), '{"main":"index.js"}');
  await writeFile(join(root, 'index.js'), "import './a.js';");
  await writeFile(join(root, 'a.js'), 'export default 1;');
  const f = await run(root, ['flow', '--json']);
  assert.ok(Array.isArray(f.nodes) && Array.isArray(f.edges) && Array.isArray(f.order));
  assert.equal(f.start, join(root, 'index.js'));
});

test('glossary --json returns the full term list with ask prompts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jglos-'));
  const g = await run(root, ['glossary', '--json']);
  assert.ok(g.length >= 20);
  assert.ok(g.every((t) => t.term && t.what && t.ask));
});
