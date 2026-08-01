// test/audit-deps-git.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildMap } from '../src/tree.js';
import { scanDeps } from '../src/audit/deps.js';
import { scanGit } from '../src/audit/githygiene.js';
const exec = promisify(execFile);

test('scanDeps reports malformed package.json as a finding instead of crashing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deps-bad-'));
  await writeFile(join(root, 'package.json'), '{ this is not valid json ]');
  const map = await buildMap(root);
  const finds = await scanDeps(map);
  assert.ok(finds.some((f) => f.kind === 'malformed_package_json'));
  assert.ok(finds.every((f) => f.category === 'deps' && typeof f.fix === 'string' && f.fix.length > 0), 'every deps finding carries a category + fix');
});

test('scanDeps flags missing lockfile and a clearly-unused dep', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deps-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { express: '^4', lodash: '^4' } }));
  await writeFile(join(root, 'index.js'), 'import express from "express";');
  const map = await buildMap(root);
  const finds = await scanDeps(map);
  assert.ok(finds.some((f) => f.kind === 'missing_lockfile'));
  assert.ok(finds.some((f) => f.kind === 'unused_dep' && f.file.includes('lodash')));
  assert.ok(finds.every((f) => f.category === 'deps' && typeof f.fix === 'string' && f.fix.length > 0), 'every deps finding carries a category + fix');
});

test('scanGit reports uncommitted files when git is present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-'));
  await writeFile(join(root, 'a.js'), 'x');
  const map = await buildMap(root);
  const finds = await scanGit(root, map);   // no git here → should be empty, not throw
  assert.ok(Array.isArray(finds));
});

test('scanGit findings carry a category + fix in a real repo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-real-'));
  await writeFile(join(root, 'a.js'), 'console.log(1);\n');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'a.js'], { cwd: root });
  await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: root });
  await writeFile(join(root, 'a.js'), 'console.log(2);\n');   // now uncommitted
  const map = await buildMap(root);
  const finds = await scanGit(root, map);
  assert.ok(finds.some((f) => f.kind === 'uncommitted'));
  assert.ok(finds.every((f) => f.category === 'git' && typeof f.fix === 'string' && f.fix.length > 0), 'every git finding carries a category + fix');
});
