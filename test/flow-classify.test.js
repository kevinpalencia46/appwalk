// test/flow-classify.test.js — the flow map's role heuristics, exported for the
// config screen (src/config.js) to reuse. Verbatim from the task-1 brief, with two
// fixture-data corrections so the assertions match their own messages and the
// classifyRole implementation: 'route in the name' uses a route-named file
// ('routes.js', not 'users.js'), and 'controller dir marks handler' uses a
// controller dir ('controllers/', not 'handlers/').
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRole, isConfigName } from '../src/flow.js';

test('isConfigName recognizes the config shapes the flow map uses', () => {
  for (const ok of ['package.json', 'tsconfig.json', 'vite.config.ts', '.gitignore', 'Dockerfile', 'Makefile', 'requirements.txt', 'eslint.config.js', 'next.config.mjs', 'weird.yml'])
    assert.equal(isConfigName(ok), true, `${ok} should be config`);
  for (const no of ['index.js', 'db.js', 'routes.js', 'README.md', 'app.html'])
    assert.equal(isConfigName(no), false, `${no} should NOT be config`);
});

test('classifyRole: name/path-based roles', () => {
  assert.equal(classifyRole('index.js', '/p/index.js', 'index.js'), 'util');
  assert.equal(classifyRole('db.js', '/p/db.js', 'db.js'), 'data');
  assert.equal(classifyRole('users.js', '/p/api/users.js', 'api/users.js'), 'util');
  assert.equal(classifyRole('routes.js', '/p/api/routes.js', 'api/routes.js'), 'route', 'route in the name');
  assert.equal(classifyRole('component.js', '/p/ui/component.js', 'ui/component.js'), 'render');
  assert.equal(classifyRole('package.json', '/p/package.json', 'package.json'), 'config');
});

test('classifyRole: entry/config override everything; code smell catches route wiring', () => {
  assert.equal(classifyRole('db.js', '/p/db.js', 'db.js', '', { isStart: true }), 'entry');
  assert.equal(classifyRole('package.json', '/p/package.json', 'package.json', '', { isStart: true }), 'entry');
  assert.equal(classifyRole('helpers.js', '/p/helpers.js', 'helpers.js', 'const app = express(); app.get("/x", h);'), 'route');
  assert.equal(classifyRole('helpers.js', '/p/helpers.js', 'helpers.js', 'module.exports = () => 1;'), 'util');
  assert.equal(classifyRole('x.js', '/p/x.js', 'controllers/x.js'), 'handler', 'controller dir marks handler');
});
