// src/tui/tour.js
import { box, bar, g, b, dim } from './kit.js';

export const init = () => ({ step: 0 });
export const hints = 'Enter continue · o open file · g glossary · q quit';

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

export function render(state, data, tour = data.tour) {
  const t = tour[state.step];
  if (!t) return box('Guided tour', ['(nothing to show)']);
  const total = tour.length;
  const header = `Guided tour · step ${state.step + 1} of ${total}`;
  const rows = [
    `  ${g('▶')}  ${b(t.title)}`,
    '',
    ...wrap(t.body, 56).map((l) => `  ${l}`),
    ...(t.files?.[0] ? ['', `  (file: ${dim(t.files[0].split('/').pop())} — press ${g('o')} to open)`] : []),
  ];
  return box(header, rows);
}

export function step(state, key, data, tour = data.tour) {
  if (key === 'enter') {
    if (state.step >= tour.length - 1) return { done: true };
    return { ...state, step: state.step + 1 };
  }
  if (key === 'o') {
    const f = tour[state.step]?.files?.[0];
    if (f) return { to: 'viewer', params: { file: f } };
    return state;
  }
  if (key === 'g') return { to: 'glossary' };   // the hints advertise it; make it real
  if (key === 'q') return { done: true };
  return state;
}
