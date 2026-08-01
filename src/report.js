// src/report.js
import { esc } from './util.js';
export function renderReport({ root, finds, map }) {
  const groups = {};
  for (const f of finds) (groups[f.kind] ||= []).push(f);
  const blocks = Object.entries(groups).map(([kind, list]) => `
    <section><h2>${esc(kind)} (${list.length})</h2>
    ${list.map((f) => `<p><code>${esc(f.file)}${f.line ? ':' + f.line : ''}</code> — ${esc(f.label || f.reason || '')}${f.snippet ? ` <b>${esc(f.snippet)}</b>` : ''}</p>`).join('\n')}
    </section>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>appwalk audit — ${esc(root)}</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1a2e}code{background:#f5f5f5;padding:1px 5px;border-radius:4px}h1{font-size:1.4rem}section{border:1px solid #eee;border-radius:8px;padding:1rem 1.2rem;margin:1rem 0}</style></head>
<body><h1>appwalk audit</h1><p>${esc(root)} · ${map.flat.length} files · ${finds.length} finding(s)</p>${blocks || '<p>No findings — clean 🎉</p>'}</body></html>`;
}
