import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step } from '../src/tui/glossary.js';
import { TERMS } from '../src/glossary.js';

test('glossary screen lists terms and Enter shows one', () => {
  const s = render(init(), {});
  assert.match(s, /refactoring|auth|RLS|dependency/);
  let st = init();
  st = step(st, 'enter', {});
  assert.ok(st.term !== null);
  assert.ok(render(st, {}).length > 40);
  assert.equal(TERMS.length >= 20, true);
});

test('glossary renders a visible cursor marker on the selected term', () => {
  const s = render(init(), {});
  assert.match(s, /\x1b\[32m▶\x1b\[0m/);   // green ▶ on the cursor row
});
