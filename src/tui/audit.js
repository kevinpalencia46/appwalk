// src/tui/audit.js — findings list with a detail view.
import { box, bar, g, b, y, r, dim } from './kit.js';

export const init = () => ({ cursor: 0, detail: null });
export const hints = '↑↓ move · Enter detail · q quit';

const color = (f) => f.kind === 'stripe_live' || f.kind === 'private_key' || f.kind === 'db_url' ? r : f.kind === 'duplicate' ? y : dim;

export function render(state, data) {
  const finds = data.findings || [];
  if (state.detail !== null) {
    const f = finds[state.detail];
    const lines = f ? [
      `  ${b(f.kind)}  ${f.file}${f.line ? ':' + f.line : ''}`,
      '',
      `  ${f.label || f.reason || ''}`,
      ...(f.snippet ? [`  snippet: ${g(f.snippet)}`] : []),
      ...(f.other ? [`  duplicate of: ${f.other} (sim ${f.sim})`] : []),
      '',
      '  (Enter to go back)',
    ] : ['  (no finding)'];
    return box('Finding', lines);
  }
  const rows = finds.map((f, i) => `  ${color(f)(f.kind === 'duplicate' ? '≡' : '⚠')}  ${f.file}${f.line ? ':' + f.line : ''}  ${(f.label || f.reason || f.kind).slice(0, 40)}`);
  return box(`audit — ${finds.length} finding${finds.length === 1 ? '' : 's'}`, rows.length ? rows : ['', '  No findings — clean 🎉', '']);
}

export function step(state, key, data) {
  const finds = (data && data.findings) || [];
  if (key === 'down') return { ...state, cursor: Math.min(state.detail !== null ? 0 : Math.max(0, finds.length - 1), state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'enter') {
    if (state.detail !== null) return { ...state, detail: null };
    return { ...state, detail: state.cursor };
  }
  if (key === 'q') return { done: true };
  return state;
}
