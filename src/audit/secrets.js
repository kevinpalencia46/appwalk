import { readFileSafe } from '../util.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  { kind: 'stripe_live', re: /sk_live_[A-Za-z0-9]{16,}/g, label: 'Stripe live secret key' },
  { kind: 'aws', re: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key' },
  { kind: 'github', re: /ghp_[A-Za-z0-9]{20,}/g, label: 'GitHub personal access token' },
  { kind: 'google', re: /AIza[0-9A-Za-z\-_]{20,}/g, label: 'Google API key' },
  { kind: 'slack', re: /xox[baprs]-[0-9A-Za-z\-]{10,}/g, label: 'Slack token' },
  { kind: 'private_key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: 'private key block' },
  { kind: 'db_url', re: /(postgres|mysql|mongodb)(\+srv)?:\/\/[^\s"']+:[^\s"']+@/g, label: 'database URL with credentials' },
  { kind: 'generic_key', re: /["'](api[_-]?key|secret|password|token)["']\s*[:=]\s*["'][A-Za-z0-9_\-.]{12,}["']/gi, label: 'hardcoded key/password' },
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
          out.push({ file: node.path, line: i + 1, kind: p.kind, snippet: mask(m[0]), label: p.label });
          break; // one finding per line
        }
      }
    }
  }
  if (hasEnv) {
    out.push({ file: '.env', line: 0, kind: 'env_in_git', snippet: '', label: '.env file is present in the project tree' });
  }
  return out;
}
