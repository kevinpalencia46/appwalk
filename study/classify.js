// The six kinds that can cost someone money or data today, plus the Supabase
// service_role key added for this study — seven in total. Everything else is
// hygiene: counted in the aggregate, never emailed, because notifying a stranger
// about a Slack token reads as spam and buries the findings that matter.
export const HIGH_KINDS = new Set([
  'aws', 'db_url', 'env_in_git', 'github', 'private_key', 'stripe_live', 'supabase_service_role',
]);

// Anchored on whole path segments so `src/latest/` does not match the tests rule.
const FIXTURE_DIR = /(^|\/)(tests?|__tests__|fixtures?|spec|docs|examples)(\/|$)/i;
const PLACEHOLDER = /^(x+…?x*|your[-_]|example|changeme|placeholder|abc123|dummy|sample)/i;

export function classify(finding) {
  const fixture =
    FIXTURE_DIR.test(finding.file || '') || PLACEHOLDER.test(finding.snippet || '');
  const severity = !fixture && HIGH_KINDS.has(finding.kind) ? 'high' : 'low';
  return { severity, fixture };
}
