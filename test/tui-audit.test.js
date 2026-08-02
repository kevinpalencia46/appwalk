import test from 'node:test';
import assert from 'node:assert/strict';
import { init, render, step, hints } from '../src/tui/audit.js';

test('audit render shows the score line and a checklist, not a flat wall of findings', () => {
  const data = { findings: [
    { file: 'a.js', line: 3, kind: 'stripe_live', category: 'secrets', snippet: 'sk_l…cdef', label: 'Stripe live secret key', fix: 'Rotate the key.' },
  ] };
  const s = render(init(), data);
  assert.match(s, /4 of 5 clean/, 'score counts the 4 clean categories');
  assert.match(s, /✓/, 'a clean category shows a check');
  assert.match(s, /✗/, 'a category with findings shows a cross');
  assert.doesNotMatch(s, /sk_l…cdef/, 'snippet stays in the detail view, not on the checklist');
});

test('a secret finding detail shows its fix and glossary link', () => {
  const data = { findings: [
    { file: 'a.js', line: 3, kind: 'stripe_live', category: 'secrets', snippet: 'sk_l…cdef', label: 'Stripe live secret key', fix: 'Rotate the key at the provider first.' },
  ] };
  let st = init();
  st = step(st, 'enter', data);       // expand the first category with findings (secrets)
  assert.equal(st.open, 'secrets');
  st = step(st, 'enter', data);       // open the finding's detail
  assert.ok(st.detail !== null);
  const s = render(st, data);
  assert.match(s, /Rotate the key at the provider first\./, 'detail shows the fix under the finding');
  assert.match(s, /stripe live secret key/i);
  assert.match(s, /glossary:/, 'detail shows a glossary link');
});

test('audit detail-view arrows leave the cursor where it was, Enter closes the detail', () => {
  const data = { findings: [
    { file: 'a.js', kind: 's', category: 'secrets' }, { file: 'b.js', kind: 's', category: 'secrets' }, { file: 'c.js', kind: 's', category: 'secrets' },
  ] };
  let st = { ...init(), cursor: 2 };
  st = step(st, 'enter', data);       // open secrets category
  assert.equal(st.open, 'secrets');
  st = step(st, 'enter', data);       // open the (2nd) finding's detail
  assert.equal(st.detail, 2);
  const after = step(step(step(st, 'down', data), 'down', data), 'up', data);
  assert.equal(after.detail, 2, 'detail stays open through arrows');
  assert.equal(after.cursor, 2, 'cursor is preserved while in the detail view');
  const closed = step(after, 'enter', data);
  assert.equal(closed.detail, null);
  assert.equal(closed.cursor, 2, 'backing out lands on the same finding');
});

test('Enter on a clean category does nothing', () => {
  const data = { findings: [] };
  const st = step(init(), 'enter', data);
  assert.equal(st.open, null, 'nothing to expand when all categories are clean');
});

test('audit hints advertise the h-home key', () => {
  assert.match(hints, /h home/);
});
