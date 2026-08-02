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

test('renderTerm includes what/why/when/ask sections', () => {
  const s = renderTerm(lookup('RLS'));
  assert.match(s, /what/i);
  assert.match(s, /why/i);
  assert.match(s, /when/i);
  assert.match(s, /When you talk to your AI/i);
});

test('every term carries an ask-your-AI prompting example', () => {
  assert.ok(TERMS.length >= 20);
  for (const t of TERMS) {
    assert.ok(t.ask && t.ask.trim().length > 10, `term ${t.term} is missing an ask phrase`);
    assert.match(t.ask, /[?.]$/, `term ${t.term} ask should read like a request`);
  }
});

test('renderTerm ends with the ask-your-AI prompt for the selected term', () => {
  const s = renderTerm(lookup('auth'));
  assert.match(s, /Walk me through adding login to my app\./);
  // the ask block is the last section of the definition
  assert.ok(s.indexOf('When you talk to your AI') > s.indexOf('When you\'d use it'));
});

test('findMatches finds terms in prose', () => {
  const m = findMatches('I want to refactor my auth flow');
  assert.ok(m.some((t) => t.includes('refactor')));
});
