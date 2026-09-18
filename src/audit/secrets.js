import { readFileSafe } from '../util.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Every secret-finding fix teaches the same rotation story: this key has been
// committed, so treat it as LEAKED — gitignoring alone does nothing for a key that's
// already in history. Rotate at the provider, store the new one in .env, then purge
// old commits (git filter-repo). The provider + where-to-revoke vary per kind, but
// the arc (leaked → rotate → .env → purge history) is identical.
const PATTERNS = [
  { kind: 'stripe_live', re: /sk_live_[A-Za-z0-9]{16,}/g, label: 'Stripe live secret key', fix: 'This key has been committed — treat it as leaked. Rotate it: at Stripe, revoke it and issue a new one; put the new key in .env; then gitignore .env and purge history (git filter-repo) so old commits stop exposing it. Gitignoring alone does NOTHING for a key already committed.' },
  { kind: 'aws', re: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key', fix: 'This key has been committed — treat it as leaked. Rotate it: at AWS, deactivate it in IAM and create a new one; put the new key in .env; then gitignore .env and purge history (git filter-repo). Gitignoring alone does NOTHING for a key already committed.' },
  { kind: 'github', re: /ghp_[A-Za-z0-9]{20,}/g, label: 'GitHub personal access token', fix: 'This token has been committed — treat it as leaked. Rotate it: revoke it at github.com/settings/tokens and create a new one; put the new token in .env; then gitignore .env and purge history (git filter-repo). Gitignoring alone does NOTHING for a token already committed.' },
  { kind: 'google', re: /AIza[0-9A-Za-z\-_]{20,}/g, label: 'Google API key', fix: 'This key has been committed — treat it as leaked. Rotate it: in Google Cloud Console, revoke it and issue a new one; put the new key in .env; then gitignore .env and purge history (git filter-repo). Gitignoring alone does NOTHING for a key already committed.' },
  { kind: 'slack', re: /xox[baprs]-[0-9A-Za-z\-]{10,}/g, label: 'Slack token', fix: 'This token has been committed — treat it as leaked. Rotate it: in Slack admin, revoke it and issue a new one; put the new token in .env; then gitignore .env and purge history (git filter-repo). Gitignoring alone does NOTHING for a token already committed.' },
  { kind: 'private_key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: 'private key block', fix: 'This key has been committed — treat it as leaked. Rotate it: generate a new key pair, remove this key file from the repo, and never commit private keys — load them from a gitignored path or a secrets manager. Then purge history (git filter-repo).' },
  { kind: 'db_url', re: /(postgres|mysql|mongodb)(\+srv)?:\/\/[^\s"']+:[^\s"']+@/g, label: 'database URL with credentials', fix: 'This URL has been committed — treat the credentials as leaked. Rotate the database password, move the connection string to .env (gitignored), then purge history (git filter-repo). Gitignoring alone does NOTHING for credentials already committed.' },
  { kind: 'generic_key', re: /["'](api[_-]?key|secret|password|token)["']\s*[:=]\s*["'][A-Za-z0-9_\-.]{12,}["']/gi, label: 'hardcoded key/password', fix: 'This key has been committed — treat it as leaked. Rotate it: at the service that issued it, revoke it and issue a new one; put the new key in .env; then gitignore .env and purge history (git filter-repo). Gitignoring alone does NOTHING for a key already committed.' },
  { kind: 'supabase_service_role', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, label: 'Supabase service_role key (bypasses row-level security)', fix: 'This key has been committed — treat it as leaked. The service_role key ignores EVERY row-level security policy, so anyone holding it can read and write your whole database. Rotate it: in Supabase go to Project Settings → API and rotate the service_role key; put the new one in .env and use it ONLY server-side, never in client code; then purge history (git filter-repo). Your anon key is fine in client code — service_role never is.' },
];

// Canonical sample/test values from vendor docs — never real secrets, so never findings.
const KNOWN_SAMPLE = new Set([
  'AKIAIOSFODNN7EXAMPLE',            // AWS docs example access key id
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', // AWS docs example secret access key
]);

function mask(s) {
  if (s.length <= 8) return s;
  return s.slice(0, 4) + '…' + s.slice(-4);
}

// Supabase keys are JWTs whose role claim decides everything: the anon key is
// PUBLIC BY DESIGN and ships in every client bundle legitimately, while
// service_role bypasses row-level security completely. A regex cannot separate
// them — the role lives inside the base64 payload — so decode it and read the
// claim. The signature is never verified: we are classifying, not authenticating.
export function decodeSupabaseRole(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims?.iss !== 'supabase') return null;
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

export async function scanSecrets(map) {
  const out = [];
  // walk() skips hidden files, so .env is detected here directly, not via the map
  const hasEnv = existsSync(join(map.root, '.env'));
  for (const node of map.flat) {
    if (node.name === '.env') continue;
    const text = await readFileSafe(node.path);
    if (!text) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        const m = p.re.exec(lines[i]);
        if (m) {
          if (KNOWN_SAMPLE.has(m[0])) continue; // sample/test keys are not findings
          // A Supabase JWT is only a finding when it carries service_role. The anon
          // key matches the same shape and lives in client code legitimately, so
          // flagging it would bury every real finding in noise. `continue` (not
          // `break`) so an anon key never masks a different secret on the same line.
          if (p.kind === 'supabase_service_role' && decodeSupabaseRole(m[0]) !== 'service_role') continue;
          out.push({ file: node.path, line: i + 1, kind: p.kind, category: 'secrets', snippet: mask(m[0]), label: p.label, fix: p.fix });
          break; // one finding per line
        }
      }
    }
  }
  if (hasEnv) {
    out.push({ file: '.env', line: 0, kind: 'env_in_git', category: 'secrets', snippet: '', label: '.env file is present in the project tree', fix: '.env holds secrets (API keys, passwords) — if it was ever committed, treat those as leaked. Rotate each key at the service that issued it, put the new ones in .env, add .env to .gitignore, run `git rm --cached .env` so it stops being tracked, then purge history (git filter-repo) so old commits stop exposing it. Gitignoring alone does NOTHING for a .env already committed.' });
  }
  return out;
}
