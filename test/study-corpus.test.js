import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawSample } from '../study/corpus.js';

const candidates = Array.from({ length: 100 }, (_, i) => ({
  full_name: `owner${i}/repo${i}`,
  clone_url: `https://github.com/owner${i}/repo${i}.git`,
  stars: i,
  pushed_at: '2026-09-01T00:00:00Z',
  stratum: 'lovable',
}));

test('draws the requested number of repos', () => {
  assert.equal(drawSample(candidates, 10, 'seed-a').length, 10);
});

test('is deterministic under the same seed', () => {
  const a = drawSample(candidates, 10, 'seed-a').map((r) => r.full_name);
  const b = drawSample(candidates, 10, 'seed-a').map((r) => r.full_name);
  assert.deepEqual(a, b);
});

test('a different seed gives a different draw', () => {
  const a = drawSample(candidates, 10, 'seed-a').map((r) => r.full_name);
  const b = drawSample(candidates, 10, 'seed-b').map((r) => r.full_name);
  assert.notDeepEqual(a, b);
});

test('never returns the same repo twice', () => {
  const names = drawSample(candidates, 50, 'seed-a').map((r) => r.full_name);
  assert.equal(new Set(names).size, 50);
});

test('returns everything when asked for more than exists', () => {
  assert.equal(drawSample(candidates, 500, 'seed-a').length, 100);
});

test('does not favour popular repos — the draw is not stars-ordered', () => {
  const stars = drawSample(candidates, 20, 'seed-a').map((r) => r.stars);
  const descending = [...stars].sort((a, b) => b - a);
  assert.notDeepEqual(stars, descending, 'a stars-ordered sample would bias the study');
});
