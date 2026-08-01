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
