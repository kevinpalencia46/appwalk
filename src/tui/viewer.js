// src/tui/viewer.js
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { box, bar, g, b, dim } from './kit.js';
import { highlight } from './highlight.js';
const readFileSafeSync = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

export const init = (params = {}) => ({ file: params.file || null, line: 0, mode: params.mode || 'view', buf: '' });
export const hints = '↑↓ scroll · Enter back · g glossary · q quit';

export function render(state, data) {
  if (state.mode === 'input') {
    return box('Ask about a file', ['', '  Type a file path (relative or absolute):', '', `  ${g('▶')} ${state.buf}_`, '', '  (Enter to open · Esc to go back)']);
  }
  const file = state.file;
  if (!file) return box('File', ['  (nothing open)', '', '  Enter a path to view a file.']);
  if (file.endsWith('.env') || file.split('/').pop() === '.env') {
    return box(file.split('/').pop(), ['', '  This is your .env file.', '', '  appwalk shows it as a location only —', '  values are never printed.', '', '  (press Enter to go back)']);
  }
  const text = readFileSafeSync(file) ?? '';
  const lang = data.map?.flat?.find((n) => n.path === file)?.lang || 'txt';
  const lines = highlight(text, lang).split('\n');
  const page = lines.slice(state.line, state.line + 18);
  const rows = page.map((l, i) => `  ${String(state.line + i + 1).padStart(3)}  ${l}`);
  return box(file.split('/').pop() || file, rows, { width: Math.min(process.stdout.columns || 80, 100) });
}

export function step(state, key, data) {
  if (state.mode === 'input') {
    if (key === 'enter') {
      const p = state.buf.trim();
      const resolved = isAbsolute(p) ? p : join(data.root, p);
      return { file: resolved, line: 0, mode: 'view', buf: '' };
    }
    if (key === '\x7f' || key === 'backspace') return { ...state, buf: state.buf.slice(0, -1) };
    if (key === 'esc' || key === 'q') return { to: 'home' };
    if (/^[A-Za-z0-9_\-./~]$/.test(key)) return { ...state, buf: state.buf + key };
    return state;
  }
  if (key === 'down') return { ...state, line: state.line + 1 };
  if (key === 'up') return { ...state, line: Math.max(0, state.line - 1) };
  if (key === 'enter' || key === 'q') return { to: 'home' };
  return state;
}
