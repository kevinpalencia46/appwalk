import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { scanDuplicates } from '../src/audit/duplicates.js';
import { scanClutter } from '../src/audit/clutter.js';

test('scanDuplicates finds near-identical files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dup-'));
  const body = 'const x = 1;\nconst y = 2;\nfunction f() { return x + y; }\n';
  await writeFile(join(root, 'a.js'), body);
  await writeFile(join(root, 'b.js'), body + '// extra comment\n');
  await writeFile(join(root, 'c.js'), '// totally different\n');
  const map = await buildMap(root);
  const finds = await scanDuplicates(map);
  assert.ok(finds.some((f) => f.file.endsWith('a.js') && f.other.endsWith('b.js')));
  assert.ok(!finds.some((f) => f.file.endsWith('c.js')));
});

test('scanClutter finds .bak/.tmp, empty dirs, and todo-only files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clut-'));
  await mkdir(join(root, 'empty'), { recursive: true });
  await writeFile(join(root, 'old.bak'), 'x');
  await writeFile(join(root, 'notes.tmp'), 'y');
  await writeFile(join(root, 'todo.js'), '// TODO fix this\n// FIXME later\n');
  const map = await buildMap(root);
  const finds = await scanClutter(map);
  assert.ok(finds.some((f) => f.file.endsWith('old.bak')));
  assert.ok(finds.some((f) => f.file.endsWith('notes.tmp')));
  assert.ok(finds.some((f) => f.file.endsWith('todo.js')));
  assert.ok(finds.some((f) => f.kind === 'empty_dir'), 'truly-empty dir at root must be flagged');
});
