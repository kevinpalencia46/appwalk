// src/tui/highlight.js
import { sanitize } from './kit.js';
const KW = new Set(['const','let','var','function','return','import','from','export','default','if','else','for','while','class','new','async','await','true','false','null','undefined','type','interface','def','print']);
const OK = new Set(['js','ts','jsx','tsx','py','json','html','css']);
// Sticky regex: matches an identifier only at the exact lastIndex position,
// so we can scan identifiers without copying the remaining string per char.
const RE_IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/y;

export function highlight(code, lang) {
  // Terminal-escape injection guard lives in kit.sanitize: source files are untrusted
  // input rendered into a raw-mode terminal, so strip ESC, C0 and C1 controls BEFORE any
  // ANSI wrapping — a repo could contain a file with embedded escape sequences.
  const s = sanitize(code);
  if (!OK.has(lang)) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1; while (j < s.length && s[j] !== ch) j++;
      if (s[j] === ch) j++;
      out += `\x1b[32m${s.slice(i, j)}\x1b[0m`; i = j; continue;
    }
    if ((ch === '/' && s[i + 1] === '/') || (lang === 'py' && ch === '#')) {
      let j = i; while (j < s.length && s[j] !== '\n') j++;
      out += `\x1b[2m${s.slice(i, j)}\x1b[0m`; i = j; continue;
    }
    RE_IDENT.lastIndex = i;
    const m = RE_IDENT.exec(s);
    if (m) {
      // Emit the WHOLE identifier in one append — emitting it char-by-char made the
      // highlighter O(L²) on long identifiers (string concat per char).
      out += KW.has(m[0]) ? `\x1b[34m${m[0]}\x1b[0m` : m[0];
      i += m[0].length;
      continue;
    }
    out += ch; i++;
  }
  return out;
}
