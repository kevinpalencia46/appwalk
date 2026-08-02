// src/tui/glossary.js — the term-list screen (module aliased as `glossaryScreen`
// in app.js to avoid clashing with the data-layer ../glossary.js import).
//
// SPLIT VIEW (no page-jump): the term list stays on the LEFT with a visible green
// cursor, and the selected term's definition renders beside it on the RIGHT in its
// own box. Moving up/down updates the definition live — there is no separate
// "open a term" screen for a beginner to get lost in. The list can be narrowed to
// only the terms a session has seen so far (`data.seenTerms`) so a beginner is
// never overwhelmed by the whole dictionary at once.
import { box, dim, g, visLen, W, wrap, sideBySide } from './kit.js';
import { TERMS, renderTerm } from '../glossary.js';

export const init = (params = {}) => ({ cursor: 0, back: params.back || null });
export const hints = '↑↓ pick a word · h home · q quit';

const termList = (data) => {
  const seen = data?.seenTerms;
  const terms = seen ? TERMS.filter((t) => seen.includes(t.term)) : TERMS;
  return { terms, seen };
};

export function render(state, data = {}) {
  const { terms, seen } = termList(data);
  const cursor = Math.min(state.cursor, Math.max(0, terms.length - 1));
  const leftRows = [
    ...(seen ? [`  ${dim('more terms unlock as you go')}`, ''] : []),
    ...terms.map((t, i) =>
      `  ${i === cursor ? g('▶') : ' '}  ${g(t.term)}${dim(' — ' + t.what.slice(0, 26))}`),
  ];
  // The list is a narrow pane on the left; the definition gets the remaining width.
  const contentW = Math.max(...leftRows.map((r) => visLen(r)));
  const leftW = Math.max(22, Math.min(34, contentW + 4));
  const left = box(seen ? `Glossary — ${terms.length} seen` : `Glossary — ${TERMS.length} terms`, leftRows, { width: leftW, min: 20, height: 'full' });

  const sel = terms[cursor] || TERMS[0];
  const rightW = Math.max(44, (W() - 2) - leftW - 2);
  const defLines = [];
  for (const raw of String(renderTerm(sel)).split('\n')) {
    if (!raw) { defLines.push(''); continue; }
    defLines.push(...wrap(raw, Math.max(20, rightW - 6)));
  }
  const right = box(sel.term, ['', ...defLines.map((l) => `  ${l}`), ''], { width: rightW, min: 44, height: 'full' });
  return sideBySide(left, right);
}

export function step(state, key, data = {}) {
  const terms = termList(data).terms;
  const max = Math.max(0, terms.length - 1);
  if (key === 'down') return { ...state, cursor: Math.min(max, state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'enter') return state;   // the definition is already on screen
  // When the glossary was opened from another screen (e.g. an audit detail's glossary
  // link), q returns to that screen instead of quitting the shell.
  if (key === 'q') return state.back ? { to: state.back } : { done: true };
  return state;
}
