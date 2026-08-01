// test/report.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/report.js';
test('renderReport produces html containing findings', () => {
  const html = renderReport({ root: '/x', map: { flat: [] }, finds: [
    { file: 'a.js', line: 3, kind: 'stripe_live', snippet: 'sk_l…ve', label: 'Stripe live secret key' },
  ] });
  assert.match(html, /<html/);
  assert.match(html, /Stripe live secret key/);
  assert.match(html, /appwalk/);
});
