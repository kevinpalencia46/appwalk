import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, render, step } from '../src/tui/audit.js';

test('audit render lists findings and Enter opens a detail', () => {
  const data = { findings: [{ file: 'a.js', line: 3, kind: 'stripe_live', snippet: 'sk_l…cdef', label: 'Stripe live secret key' }] };
  const s = render(init(), data);
  assert.match(s, /stripe live secret key/i);
  let st = init();
  st = step(st, 'enter', data);
  assert.ok(st.detail !== null);
  assert.match(render(st, data), /stripe live secret key/i);
});
test('audit detail-view arrows leave the cursor where it was, Enter closes the detail', () => {
  const data = { findings: [{ file: 'a.js', kind: 's' }, { file: 'b.js', kind: 's' }, { file: 'c.js', kind: 's' }] };
  let st = { ...init(), cursor: 2 };
  st = step(st, 'enter', data);
  assert.equal(st.detail, 2);
  const after = step(step(step(st, 'down', data), 'down', data), 'up', data);
  assert.equal(after.detail, 2, 'detail stays open through arrows');
  assert.equal(after.cursor, 2, 'cursor is preserved while in the detail view');
  const closed = step(after, 'enter', data);
  assert.equal(closed.detail, null);
  assert.equal(closed.cursor, 2, 'backing out lands on the same finding');
});
