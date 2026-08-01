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
