// src/tui/glossary.js — the term-list screen (module aliased as `glossaryScreen`
// in app.js to avoid clashing with the data-layer ../glossary.js import).
import { box, bar, b, dim } from './kit.js';
import { TERMS, renderTerm } from '../glossary.js';

export const init = () => ({ cursor: 0, term: null });
export const hints = '↑↓ move · Enter show · q quit';

export function render(state) {
  if (state.term !== null) {
    const t = TERMS[state.term];
    return box('Glossary', ['', ...String(renderTerm(t)).split('\n').map((l) => `  ${l}`), '', '  (Enter to go back)']);
  }
  const rows = TERMS.map((t, i) => `  ${b(t.term)}${dim(' — ' + t.what.slice(0, 34))}`);
  return box(`Glossary — ${TERMS.length} terms`, rows);
}

export function step(state, key) {
  if (key === 'down') return { ...state, cursor: Math.min(TERMS.length - 1, state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'enter') { if (state.term !== null) return { ...state, term: null }; return { ...state, term: state.cursor }; }
  if (key === 'q') return { done: true };
  return state;
}
