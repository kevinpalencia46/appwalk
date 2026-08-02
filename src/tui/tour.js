// src/tui/tour.js
import { box, boxWidth, MASCOT, g, b, dim, sanitize, wrap } from './kit.js';

export const init = () => ({ step: 0 });
export const hints = 'Press ENTER to continue · o = open the file · g = glossary · h = home';

export function render(state, data, tour = data.tour) {
  const t = tour[state.step];
  if (!t) return box('Guided tour', ['(nothing to show)']);
  const total = tour.length;
  const header = `Guided tour · step ${state.step + 1} of ${total}`;
  const w = boxWidth('full');
  const rows = [
    ...MASCOT.split('\n').map((l) => `  ${l}`),
    '',
    `  ${g('▶')}  ${b(t.title)}`,
    '',
    ...wrap(sanitize(t.body), w - 10).map((l) => `  ${l}`),
    ...(t.files?.[0] ? ['', `  (file: ${dim(t.files[0].split('/').pop())} — press ${g('o')} to open)`] : []),
  ];
  return box(header, rows, { width: 'full' });
}

export function step(state, key, data, tour = data.tour) {
  if (key === 'enter') {
    if (state.step >= tour.length - 1) return { to: 'home', params: { celebrate: true } };
    return { ...state, step: state.step + 1 };
  }
  if (key === 'o') {
    const f = tour[state.step]?.files?.[0];
    if (f) return { to: 'viewer', params: { file: f, back: 'tour' } };
    return state;
  }
  if (key === 'g') return { to: 'glossary' };   // the hints advertise it; make it real
  if (key === 'q') return { done: true };
  return state;
}
