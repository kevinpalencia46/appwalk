// src/tui/tour.js
import { box, boxWidth, g, dg, dim, sanitize, wrap } from './kit.js';
import { suggest } from './try.js';

export const init = () => ({ step: 0 });
// Dynamic so the bar never advertises 't = try it' on a step whose stack has nothing
// safe to run (suggest() returns null) — a no-op key advertised is a dead end.
// The choose-your-model step is a picker, so its hints describe the picker instead.
export const hints = (state, data) => {
  const t = data?.tour?.[state?.step];
  if (t?.models) return '↑↓ choose a model · ENTER expand detail · ENTER again to continue · h = home · q = quit';
  const s = t ? suggest(data?.stack, t) : null;
  return 'Press ENTER to continue · o = open the file · g = glossary' + (s ? ' · t = try it' : '') + ' · h = home';
};

// A model row + its expanded setup detail. `good at` and `setup` wrap so a row
// never exceeds the ~74-column content cap.
function modelRows(models, state, width) {
  const sel = state.modelSel ?? 0;
  const expanded = state.modelDetail === sel;
  const labelW = Math.max(...models.map((m) => m.label.length)) + 1;
  const rows = [];
  models.forEach((m, i) => {
    const cursor = i === sel ? g('▶') : ' ';
    rows.push(`  ${cursor}  ${g(m.label.padEnd(labelW))} ${dg('— ' + m.cost)}`);
    rows.push(...wrap(`good at: ${m.goodAt}`, width - 8).map((l) => `        ${dim(l)}`));
    if (i === sel && expanded) {
      rows.push('');
      rows.push(...wrap(`setup: ${m.setup}`, width - 8).map((l) => `        ${dg(l)}`));
    }
  });
  return rows;
}

export function render(state, data, tour = data.tour) {
  const t = tour[state.step];
  if (!t) return box('Guided tour', ['  (nothing to show) (FAQ: usage)']);
  const total = tour.length;
  const header = `Guided tour · step ${state.step + 1} of ${total}`;
  const w = boxWidth('full');
  const s = suggest(data?.stack, t);
  const rows = t.models
    ? [
        `  ${g('▶')}  ${g(t.title)}`,
        '',
        ...modelRows(t.models, state, w - 10),
        '',
        `  ${dim('Press ENTER to expand a model — press it again to keep walking.')}`,
      ]
    : [
        `  ${g('▶')}  ${g(t.title)}`,
        '',
        ...wrap(sanitize(t.body), w - 10).map((l) => `  ${l}`),
        ...(t.files?.[0] ? ['', `  (file: ${dim(t.files[0].split('/').pop())} — press ${g('o')} to open)`] : []),
        ...(s ? ['', `  Press ${g('t')} to try it — ${dim(s.label)}`] : []),
      ];
  return box(header, rows, { width: 'full' });
}

export function step(state, key, data, tour = data.tour) {
  const t = tour[state.step];
  // The choose-your-model step is a picker: arrows move the selection, Enter toggles
  // the expanded setup detail, and a second Enter (with the detail open) continues.
  if (t?.models) {
    if (key === 'up') return { ...state, modelSel: Math.max(0, (state.modelSel ?? 0) - 1), modelDetail: null };
    if (key === 'down') return { ...state, modelSel: Math.min(t.models.length - 1, (state.modelSel ?? 0) + 1), modelDetail: null };
    if (key === 'enter') {
      if (state.modelDetail === (state.modelSel ?? 0)) {
        if (state.step >= tour.length - 1) return { to: 'home', params: { celebrate: true } };
        return { ...state, step: state.step + 1 };
      }
      return { ...state, modelDetail: state.modelSel ?? 0 };
    }
    if (key === 'g') return { to: 'glossary' };
    if (key === 'q') return { done: true };
    return state;
  }
  if (key === 'enter') {
    if (state.step >= tour.length - 1) return { to: 'home', params: { celebrate: true } };
    return { ...state, step: state.step + 1 };
  }
  if (key === 'o') {
    const f = tour[state.step]?.files?.[0];
    if (f) return { to: 'viewer', params: { file: f, back: 'tour' } };
    return state;
  }
  if (key === 't') {
    const s = suggest(data?.stack, tour[state.step]);
    if (s) return { to: 'try', params: { ...s, back: 'tour' } };
    return state;
  }
  if (key === 'g') return { to: 'glossary' };   // the hints advertise it; make it real
  if (key === 'q') return { done: true };
  return state;
}
