// src/tui/viewer.js
// View mode: a syntax-colored, paged view of an open file.
// Input mode ("Ask about a file"): instead of a blank path prompt, the project's
// files are listed on the left with a cursor. The user either types to filter the
// list and presses Enter to open the top match, or arrows to a file and presses
// Enter to open it. Typing a path that matches nothing still opens that path, so
// absolute/other paths keep working.
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { box, g, b, dim } from './kit.js';
import { highlight } from './highlight.js';
const readFileSafeSync = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

export const init = (params = {}) => ({ file: params.file || null, line: 0, mode: params.mode || 'view', buf: '', pick: 0, back: params.back || null });
export const hints = '↑↓ scroll · Enter back · g glossary · q quit';

const relPath = (root, p) => (root && p && p.startsWith(root + '/') ? p.slice(root.length + 1) : p);

// The project's files as a filterable list (capped so a big repo never overwhelms).
const listFiles = (data, buf) => {
  const q = String(buf || '').trim().toLowerCase();
  const all = (data?.map?.flat || []).slice(0, 40);
  if (!q) return all;
  return all.filter((n) =>
    n.path.toLowerCase().includes(q) ||
    (n.name || '').toLowerCase().includes(q) ||
    relPath(data.root, n.path).toLowerCase().includes(q));
};

export function render(state, data) {
  if (state.mode === 'input') {
    const files = listFiles(data, state.buf);
    const total = (data?.map?.flat || []).length;
    const pick = Math.min(state.pick, Math.max(0, files.length - 1));
    const WINDOW = 14;
    const start = files.length ? Math.max(0, Math.min(pick - Math.floor(WINDOW / 2), files.length - WINDOW)) : 0;
    const shown = files.slice(start, start + WINDOW);
    // The list is capped at 40 so a big repo never overwhelms — the count line must
    // reflect that (e.g. "showing first 40 of 396 files"), not read as the real total.
    const countLine = state.buf.trim()
      ? `${files.length} file${files.length === 1 ? '' : 's'} matching`
      : total > files.length
        ? `showing first ${files.length} of ${total} file${total === 1 ? '' : 's'}`
        : `${total} file${total === 1 ? '' : 's'}`;
    const rows = [
      `  ${dim('type to filter · ↑↓ pick · ENTER to open')}`,
      '',
      ...(files.length === 0
        ? [`  ${dim('(no matching files — type a path and press ENTER)')}`]
        : shown.map((n, i) => {
            const r = relPath(data.root, n.path);
            return `  ${i + start === pick ? g('▶') : ' '}  ${n.entry ? g('●') : ' '}  ${r}`;
          })),
      ...(files.length ? [`  ${dim(countLine)}`] : []),
      '',
      `  ${b('$')} ${state.buf}_`,
    ];
    return box('Ask about a file', rows, { width: 'full' });
  }
  const file = state.file;
  if (!file) return box('File', ['  (nothing open)', '', '  Enter a path to view a file.']);
  const base = file.split('/').pop() || '';
  // Refuse every dotenv variant (.env, .env.local, .env.production, …), never just .env
  if (/^\.env(\.|$)/.test(base)) {
    return box(base, ['', '  This is your .env file.', '', '  appwalk shows it as a location only —', '  values are never printed.', '', '  (press Enter to go back)']);
  }
  const text = readFileSafeSync(file) ?? '';
  const lang = data.map?.flat?.find((n) => n.path === file)?.lang || 'txt';
  // Page first, then highlight — never highlight unshown lines (huge files
  // would stall the keypress handler otherwise).
  const page = text.split('\n').slice(state.line, state.line + 18);
  const rows = page.map((l, i) => `  ${String(state.line + i + 1).padStart(3)}  ${highlight(l, lang)}`);
  return box(file.split('/').pop() || file, rows, { width: 'full' });
}

export function step(state, key, data) {
  if (state.mode === 'input') {
    if (key === 'enter') {
      const files = listFiles(data, state.buf);
      const picked = files[Math.min(state.pick, Math.max(0, files.length - 1))];
      // A picked list file wins; otherwise fall back to the typed string as a path so
      // absolute/other paths keep working even when nothing in the list matches.
      const target = (picked && picked.path) || state.buf.trim();
      if (!target) return state;
      const resolved = isAbsolute(target) ? target : join(data.root, target);
      return { file: resolved, line: 0, mode: 'view', buf: '', pick: 0, back: state.back };
    }
    if (key === 'down') {
      const n = listFiles(data, state.buf).length;
      return { ...state, pick: Math.min(Math.max(0, n - 1), state.pick + 1) };
    }
    if (key === 'up') return { ...state, pick: Math.max(0, state.pick - 1) };
    if (key === '\x7f' || key === 'backspace') return { ...state, buf: state.buf.slice(0, -1), pick: 0 };
    if (key === 'esc' || key === 'q') return { to: state.back || 'home' };
    if (/^[A-Za-z0-9_\-./~ ]$/.test(key)) return { ...state, buf: state.buf + key, pick: 0 };
    return state;
  }
  if (key === 'down') {
    const totalLines = (readFileSafeSync(state.file) ?? '').split('\n').length;
    return { ...state, line: Math.max(0, Math.min(totalLines - 1, state.line + 1)) };
  }
  if (key === 'up') return { ...state, line: Math.max(0, state.line - 1) };
  if (key === 'enter' || key === 'q') return { to: state.back || 'home' };
  return state;
}
