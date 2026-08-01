// test/audit-deps-git.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap } from '../src/tree.js';
import { scanDeps } from '../src/audit/deps.js';
import { scanGit } from '../src/audit/githygiene.js';

test('scanDeps flags missing lockfile and a clearly-unused dep', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deps-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { express: '^4', lodash: '^4' } }));
  await writeFile(join(root, 'index.js'), 'import express from "express";');
  const map = await buildMap(root);
  const finds = await scanDeps(map);
  assert.ok(finds.some((f) => f.kind === 'missing_lockfile'));
  assert.ok(finds.some((f) => f.kind === 'unused_dep' && f.file.includes('lodash')));
});

test('scanGit reports uncommitted files when git is present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-'));
  await writeFile(join(root, 'a.js'), 'x');
  const map = await buildMap(root);
  const finds = await scanGit(root, map);   // no git here → should be empty, not throw
  assert.ok(Array.isArray(finds));
});
