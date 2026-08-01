// test/glossary.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, lookup, renderTerm, findMatches } from '../src/glossary.js';

test('lookup finds a term case-insensitively', () => {
  assert.ok(lookup('api key'));
  assert.ok(lookup('API KEY'));
  assert.equal(lookup('not-a-real-term'), null);
});

test('TERMS covers the spec\'s required topics', () => {
  const terms = TERMS.map((t) => t.term);
  for (const required of ['refactoring', 'debugging', 'RLS', 'auth', 'environment variable', 'dependency', 'deploy']) {
    assert.ok(terms.some((t) => t.includes(required.split(' ')[0].toLowerCase())), `missing ${required}`);
  }
});

test('renderTerm includes what/why/when sections', () => {
  const s = renderTerm(lookup('RLS'));
  assert.match(s, /what/i);
  assert.match(s, /why/i);
  assert.match(s, /when/i);
});

test('findMatches finds terms in prose', () => {
  const m = findMatches('I want to refactor my auth flow');
  assert.ok(m.some((t) => t.includes('refactor')));
});
