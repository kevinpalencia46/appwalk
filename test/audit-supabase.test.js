import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeSupabaseRole, scanSecrets } from '../src/audit/secrets.js';

// Build a JWT carrying the real Supabase payload shape, observed 2026-09-17 in a
// live Lovable app: {"iss":"supabase","ref":"…","role":"anon","iat":…,"exp":…}.
// The signature is irrelevant — we never verify it, we only read the role claim.
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;
}

const serviceRole = () =>
  jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role', iat: 1, exp: 2 });
const anonKey = () =>
  jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon', iat: 1, exp: 2 });

test('reads service_role out of a Supabase JWT', () => {
  assert.equal(decodeSupabaseRole(serviceRole()), 'service_role');
});

test('reads anon out of a Supabase JWT', () => {
  assert.equal(decodeSupabaseRole(anonKey()), 'anon');
});

test('ignores a JWT that is not issued by supabase', () => {
  assert.equal(decodeSupabaseRole(jwt({ iss: 'auth0', role: 'service_role' })), null);
});

test('returns null for malformed base64 rather than throwing', () => {
  assert.equal(decodeSupabaseRole('eyJhbGciOiJIUzI1NiJ9.!!!notbase64!!!.sig'), null);
});

test('returns null for a string that is not a JWT at all', () => {
  assert.equal(decodeSupabaseRole('hello world'), null);
});

test('returns null when the payload is valid base64 but not JSON', () => {
  const notJson = Buffer.from('plain text').toString('base64url');
  assert.equal(decodeSupabaseRole(`eyJhbGciOiJIUzI1NiJ9.${notJson}.sig`), null);
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'appwalk-sb-'));
  const flat = [];
  for (const [name, body] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
    flat.push({ name, path: p });
  }
  return { root, flat };
}

test('flags a service_role key found in source', async () => {
  const t = serviceRole();
  const found = await scanSecrets(fixture({ 'server.ts': `const key = "${t}";` }));
  const hit = found.find((f) => f.kind === 'supabase_service_role');
  assert.ok(hit, 'service_role key must be reported');
  assert.equal(hit.line, 1);
  assert.equal(hit.category, 'secrets');
  assert.ok(!hit.snippet.includes(t), 'the raw key must never appear in the snippet');
});

test('does NOT flag the anon key — it is public by design', async () => {
  const found = await scanSecrets(fixture({ 'client.ts': `const key = "${anonKey()}";` }));
  assert.equal(found.filter((f) => f.kind === 'supabase_service_role').length, 0);
});

test('an anon key on a line does not mask a different secret on that line', async () => {
  const line = `const a = "${anonKey()}"; const b = "sk_live_abcdefghijklmnop";`;
  const found = await scanSecrets(fixture({ 'mixed.ts': line }));
  assert.ok(found.some((f) => f.kind === 'stripe_live'), 'the Stripe key must still be reported');
});
