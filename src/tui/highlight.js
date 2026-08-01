// src/tui/highlight.js
const KW = new Set(['const','let','var','function','return','import','from','export','default','if','else','for','while','class','new','async','await','true','false','null','undefined','type','interface','def','print']);
const OK = new Set(['js','ts','jsx','tsx','py','json','html','css']);

export function highlight(code, lang) {
  if (!OK.has(lang)) return code;
  let out = '';
  let i = 0;
  const s = String(code);
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
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));
    if (m && KW.has(m[0])) { out += `\x1b[34m${m[0]}\x1b[0m`; i += m[0].length; continue; }
    out += ch; i++;
  }
  return out;
}
