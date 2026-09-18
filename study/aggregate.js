import { createHash } from 'node:crypto';
import { classify } from './classify.js';

// Repo identity is hashed on the way into the publication view. The plaintext
// name lives only in the local findings store, which is what the disclosure
// round reads and what never leaves this machine.
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function aggregate(records) {
  const out = {
    sample: records.length,
    scanned: 0,
    attrition: {},
    byKind: {},
    byKindReal: {},
    highSeverityRepos: 0,
    fixtureRate: 0,
    repos: [],
  };

  let findings = 0;
  let fixtures = 0;

  for (const rec of records) {
    if (rec.outcome === 'ok') out.scanned++;
    else out.attrition[rec.outcome] = (out.attrition[rec.outcome] || 0) + 1;

    let high = false;
    for (const f of rec.findings) {
      findings++;
      const c = classify(f);
      if (c.fixture) fixtures++;
      else out.byKindReal[f.kind] = (out.byKindReal[f.kind] || 0) + 1;
      if (c.severity === 'high') high = true;
      out.byKind[f.kind] = (out.byKind[f.kind] || 0) + 1;
    }
    if (high) out.highSeverityRepos++;
    out.repos.push({ id: hash(rec.full_name), stratum: rec.stratum, outcome: rec.outcome, high });
  }

  out.fixtureRate = findings ? fixtures / findings : 0;
  out.totalFindings = findings;
  return out;
}
