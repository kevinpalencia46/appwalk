// test/flow.test.js — the flow map data layer (src/flow.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { detectStack } from '../src/walkthrough.js';
import { buildFlow, formatFlow } from '../src/flow.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// A tiny Express-ish fixture: entry imports a route file which requires a db util,
// and one handler is referenced ONLY by a route registration (string path), not an
// import — so the route->handler edge is genuinely load-bearing.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'flow-'));
  await mkdir(join(root, 'api'), { recursive: true });
  await mkdir(join(root, 'handlers'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"name":"flow-fixture","main":"index.js"}');
  await writeFile(join(root, 'index.js'), [
    "import express from 'express';",
    "import routes from './api/routes.js';",
    'const app = express();',
    "app.use('/api', routes);",
    "app.get('/ping', './handlers/ping.js');",
    'export default app;',
  ].join('\n'));
  await writeFile(join(root, 'api', 'routes.js'), [
    "const db = require('../db.js');",
    "const router = require('express').Router();",
    "router.get('/users', (req, res) => { db.query(); });",
    'module.exports = router;',
  ].join('\n'));
  await writeFile(join(root, 'db.js'), 'module.exports.query = () => {};');
  await writeFile(join(root, 'handlers', 'ping.js'), "export default (req, res) => res.send('pong');");
  const map = await buildMap(root);
  const stack = detectStack(map);
  return { root, map, stack };
}

test('buildFlow resolves the start from package.json main and follows imports/requires/routes', async () => {
  const { root, map, stack } = await fixture();
  const flow = await buildFlow(map, stack, { depth: 2 });
  assert.equal(flow.start, join(root, 'index.js'), 'entry resolved from package.json main, not package.json itself');
  assert.equal(flow.order.length, 4, 'index, routes, db, ping all shown at depth 2');

  const node = (name) => flow.nodes.find((n) => n.name === name);
  assert.equal(node('index.js').role, 'entry');
  assert.equal(node('routes.js').role, 'route');
  assert.equal(node('db.js').role, 'data');
  assert.equal(node('ping.js').role, 'handler');

  const has = (from, to) => flow.edges.some((e) => e.from === join(root, from) && e.to === join(root, to));
  assert.ok(has('index.js', 'api/routes.js'), 'index -> routes via import');
  assert.ok(has('index.js', 'handlers/ping.js'), 'index -> ping via route registration (string handler path)');
  assert.ok(has('api/routes.js', 'db.js'), 'routes -> db via require');
  assert.equal(flow.edges.length, 3);
});

test('depth caps the backbone and collapses deeper files into "+N more"', async () => {
  const { root, map, stack } = await fixture();
  const flow = await buildFlow(map, stack, { depth: 1 });
  assert.equal(flow.start, join(root, 'index.js'));
  assert.deepEqual(flow.order.map((p) => p.split('/').pop()), ['index.js', 'routes.js', 'ping.js']);
  assert.ok(!flow.order.some((p) => p.endsWith('db.js')), 'db.js is deeper than depth 1, so it is hidden');
  const routes = flow.nodes.find((n) => n.name === 'routes.js');
  assert.equal(routes.more, 1, 'routes.js has one child (db.js) beyond depth');

  const lines = formatFlow(flow, { depth: 1 });
  assert.equal(lines.length, flow.order.length, 'formatFlow emits exactly one line per node');
  assert.match(lines[0], /● start/);
  assert.match(lines[0], /index\.js/);
  assert.match(lines[1], /api\/routes\.js/);
  assert.match(lines[1], /\(\+1 more\)/, 'the parent shows its collapsed child');
  assert.match(lines[2], /handlers\/ping\.js/);
});

test('raising depth reveals the deeper files and clears the "+N more"', async () => {
  const { map, stack } = await fixture();
  const flow = await buildFlow(map, stack, { depth: 2 });
  const lines = formatFlow(flow, { depth: 2 });
  assert.equal(lines.length, 4);
  assert.match(lines[2], /db\.js/);
  assert.doesNotMatch(lines.join('\n'), /\(\+\d+ more\)/, 'nothing is collapsed at depth 2 for this fixture');
  // the tree still flows: index -> routes -> db -> (sibling) ping
  assert.ok(lines[1].includes('routes.js') && lines[2].includes('db.js') && lines[3].includes('ping.js'));
});

test('breadth cap keeps a fan-out node to 6 children and reports the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flow-fan-'));
  await writeFile(join(root, 'package.json'), '{"main":"entry.js"}');
  await writeFile(join(root, 'entry.js'), Array.from({ length: 8 }, (_, i) => `import m${i} from './m${i}.js';`).join('\n'));
  for (let i = 0; i < 8; i++) await writeFile(join(root, `m${i}.js`), `export const m${i} = ${i};`);
  const map = await buildMap(root);
  const flow = await buildFlow(map, detectStack(map), { depth: 2 });

  assert.equal(flow.nodes.length, 7, '1 entry + 6 capped children, not all 9');
  const entry = flow.nodes.find((n) => n.role === 'entry');
  assert.equal(entry.more, 2, '8 children - 6 shown = 2 collapsed');
  const lines = formatFlow(flow, { depth: 2 });
  assert.equal(lines.length, 7);
  assert.match(lines[0], /\(\+2 more\)/);
  // the six shown children are the first six by name
  assert.match(lines.join('\n'), /m5\.js/);
  assert.doesNotMatch(lines.join('\n'), /m6\.js|m7\.js/);
});

test('static sites: index.html links its scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flow-static-'));
  await writeFile(join(root, 'index.html'), '<html><body><script src="app.js"></script></body></html>');
  await writeFile(join(root, 'app.js'), 'console.log("hi");');
  const map = await buildMap(root);
  const stack = detectStack(map);   // static, entry index.html
  const flow = await buildFlow(map, stack, { depth: 2 });
  assert.equal(flow.start, join(root, 'index.html'));
  assert.deepEqual(flow.edges.map((e) => e.to.split('/').pop()), ['app.js']);
  assert.equal(flow.nodes.find((n) => n.name === 'app.js').role, 'util');
});

test('unknown patterns and bare packages never crash the analysis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flow-tough-'));
  await writeFile(join(root, 'package.json'), '{"main":"entry.js"}');
  await writeFile(join(root, 'entry.js'), [
    "import express from 'express';",
    "const fs = require('fs');",
    "const missing = require('./nope.js');",
    "app.get('/x', 42);",                       // handler is a number — ignored
    "router.use(<Component />, something);",    // jsx-ish noise — ignored, no crash
    "const x = () => { return import('./nope2.js'); };",
    "// import ghost from './real.js';",        // commented-out import — never live
  ].join('\n'));
  await writeFile(join(root, 'real.js'), 'export const real = 1;');
  const map = await buildMap(root);
  const flow = await buildFlow(map, detectStack(map), { depth: 3 });
  assert.equal(flow.start, join(root, 'entry.js'));
  assert.deepEqual(flow.edges, [], 'no resolvable children — bare/npm and missing specs only');
  assert.equal(flow.nodes.length, 1);
});
