import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/glossary.js';
import { TERMS } from '../src/glossary.js';

test('glossary renders a two-pane split: a list term AND its definition at once', () => {
  const s = render(init(), {});
  assert.match(s, /refactoring|auth|RLS|dependency/, 'list pane shows terms');
  assert.match(s, /What it is:/, 'definition pane is on screen without pressing Enter');
  assert.match(s, /TERM:/, 'renderTerm block is shown');
  assert.equal(TERMS.length >= 20, true);
});

test('glossary renders a visible green cursor on the selected term', () => {
  const s = render(init(), {});
  assert.match(s, /\x1b\[32m▶\x1b\[0m/);
});

test('glossary seenTerms narrows the list to only what has been seen', () => {
  const s = render(init(), { seenTerms: ['auth'] });
  assert.match(s, /auth/);
  assert.match(s, /TERM: auth/, 'definition pane shows the seen term');
  assert.doesNotMatch(s, /refactoring/, 'unseen terms stay hidden');
  assert.match(s, /more terms unlock as you go/);
});

test('glossary step: arrows move the cursor and q quits or returns to the caller', () => {
  assert.equal(step(init(), 'down', {}).cursor, 1);
  assert.equal(step(init(), 'up', {}).cursor, 0);
  assert.deepEqual(step(init(), 'q', {}), { done: true });
  assert.deepEqual(step(init({ back: 'audit' }), 'q', {}), { to: 'audit' });
});
