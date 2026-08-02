import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { suggestFiling } from '../src/config.js';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'filing-'));
  for (const [p, txt] of Object.entries(files)) {
    await mkdir(join(root, p.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    await writeFile(join(root, p), txt);
  }
  return root;
}
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const groupFor = (groups, role) => groups.find((g) => g.role === role);

test('scattered route handlers produce a routes/ suggestion', async () => {
  // Bare a.js/b.js/c.js classify as util (classifyRole has no flow handlerRefs);
  // a *.handler.js name is what the exported classifier recognizes as 'handler'.
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "import a from './api/a.handler.js'; import b from './routes/b.handler.js'; import c from './c.handler.js';",
    'api/a.handler.js': 'export default (req, res) => {};',
    'routes/b.handler.js': 'export default (req, res) => {};',
    'c.handler.js': 'export default (req, res) => {};',
  });
  const { groups } = await suggestFiling(await buildMap(root));
  const handlers = groupFor(groups, 'handler');
  assert.ok(handlers, '3+ files of a role group into a suggestion');
  assert.ok(handlers.files.length >= 3);
  assert.match(handlers.suggestion, /routes\//, 'suggests a routes/ folder for scattered handlers');
});

test('already-grouped files get a good note, not a suggestion', async () => {
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "import h from './handlers/a.handler.js'; import g from './handlers/b.handler.js'; import f from './handlers/c.handler.js';",
    'handlers/a.handler.js': 'export default () => {};',
    'handlers/b.handler.js': 'export default () => {};',
    'handlers/c.handler.js': 'export default () => {};',
  });
  const { groups } = await suggestFiling(await buildMap(root));
  const handlers = groupFor(groups, 'handler');
  assert.ok(handlers);
  assert.equal(handlers.suggestion, null);
  assert.match(handlers.note, /good/i);
});

test('fewer than 3 files of a role produce no group', async () => {
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "import a from './a.handler.js'; import b from './b.handler.js';",
    'a.handler.js': 'export default () => {};',
    'b.handler.js': 'export default () => {};',
  });
  const { groups } = await suggestFiling(await buildMap(root));
  assert.equal(groups.some((g) => g.role === 'handler'), false, '2 handlers is below the threshold — no noise');
});

test('express route wiring is caught by the code smell even without a route name', async () => {
  const root = await fixture({
    'package.json': '{"main":"index.js"}',
    'index.js': "const app = require('express')();\napp.get('/', (req, res) => res.send('hi'));",
    'api/users.js': "const router = require('express').Router();\nrouter.get('/users', (req, res) => res.send([]));",
    'routes/posts.js': "const router = require('express').Router();\nrouter.post('/posts', (req, res) => res.send({}));",
  });
  const { groups } = await suggestFiling(await buildMap(root));
  const routes = groupFor(groups, 'route');
  assert.ok(routes, 'route-wiring files are grouped via the code smell');
  assert.match(routes.suggestion, /routes\//);
});

test('tips are present and non-empty', async () => {
  const root = await fixture({ 'package.json': '{"main":"index.js"}', 'index.js': '// hi' });
  const { tips } = await suggestFiling(await buildMap(root));
  assert.ok(Array.isArray(tips) && tips.length >= 3, 'a small set of best-practice tips');
  assert.ok(tips.every((t) => strip(t).length > 0));
});
