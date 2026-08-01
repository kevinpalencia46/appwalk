import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esc, humanSize, langOf, walk, readIgnore } from '../src/util.js';

test('esc escapes html + quotes', () => {
  assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;');
});
test('humanSize formats bytes', () => {
  assert.equal(humanSize(0), '0 B');
  assert.equal(humanSize(1536), '1.5 KB');
  assert.equal(humanSize(5 * 1024 * 1024), '5.0 MB');
});
test('langOf detects common extensions', () => {
  assert.equal(langOf('/a/b/main.js'), 'js');
  assert.equal(langOf('x.ts'), 'ts');
  assert.equal(langOf('y.py'), 'py');
  assert.equal(langOf('z'), 'text');
});
test('walk skips node_modules, .git, ignored dirs, and ignores by gitignore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'walk-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'src', 'a.js'), 'x');
  await writeFile(join(root, 'node_modules', 'b.js'), 'y');
  await writeFile(join(root, 'dist', 'c.js'), 'z');
  await writeFile(join(root, '.gitignore'), '*.tmp\n');
  await writeFile(join(root, 'ignored.tmp'), 'nope');
  const files = (await walk(root)).map((p) => p.replace(root + '/', ''));
  assert.ok(files.includes('src/a.js'));
  assert.ok(!files.includes('node_modules/b.js'));
  assert.ok(!files.includes('dist/c.js'));
  assert.ok(!files.includes('ignored.tmp'));
});
