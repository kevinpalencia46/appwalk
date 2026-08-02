// test/tui-about.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { aboutFile } from '../src/tui/about.js';

test('aboutFile on a package.json node teaches scripts and dependencies', () => {
  const lines = aboutFile({ name: 'package.json', lang: 'json', size: 408 });
  assert.ok(lines.some((l) => /scripts/i.test(l)), 'mentions scripts');
  assert.ok(lines.some((l) => /dependencies/i.test(l)), 'mentions dependencies');
  assert.ok(lines.some((l) => /ID card/i.test(l)), 'explains what a settings file is');
  assert.ok(lines.some((l) => /sticky note/i.test(l)), 'explains a small byte size in plain words');
});

test('aboutFile on a .js node explains JavaScript', () => {
  const lines = aboutFile({ name: 'index.js', lang: 'js', size: 42 });
  assert.ok(lines.some((l) => /JavaScript/.test(l)), 'explains what JavaScript is');
});

test('aboutFile explains the byte size meaning and what it says about the file', () => {
  const big = aboutFile({ name: 'big.js', lang: 'js', size: 150 * 1024 });
  assert.ok(big.some((l) => /large/.test(l)), 'calls a 100KB+ file large');
  const small = aboutFile({ name: 'tiny.js', lang: 'js', size: 408 });
  assert.ok(small.some((l) => /sticky note/.test(l)), 'calls a tiny file small');
});
