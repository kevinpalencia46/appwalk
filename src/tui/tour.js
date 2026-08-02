// src/tui/tour.js
import { box, boxWidth, g, dg, dim, sanitize, wrap, wrapParas, visLen } from './kit.js';
import { suggest } from './try.js';

export const init = (params = {}) => ({ step: params.resume ?? 0 });
// Dynamic so the bar never advertises 't = try it' on a step whose stack has nothing
// safe to run (suggest() returns null) — a no-op key advertised is a dead end.
// The choose-your-model step is a picker, so its hints describe the picker instead.
// `b` and ← go back a step; `h` still means home (handled globally in the shell).
export const hints = (state, data) => {
  const t = data?.tour?.[state?.step];
  if (t?.models) return '↑↓ choose a model · ENTER expand detail · ENTER again continues · ←/b back · g = glossary · h = home · q = quit';
  const s = t ? suggest(data?.stack, t) : null;
  return '← back · Enter next · o = open · g = glossary' + (s ? ' · t = try it' : '') + ' · h = home';
};

// A model row + its expanded setup detail. `good at` and `setup` wrap so a row
// never exceeds the ~74-column content cap. Collapsed rows stay compact so the
// 4-row picker fits a small terminal; only the Enter-expanded detail gets
// breathing room — blank lines between the cost / good-at / setup sections.
function modelRows(models, state, width) {
  const sel = state.modelSel ?? 0;
  const expanded = state.modelDetail === sel;
  const labelW = Math.max(...models.map((m) => m.label.length)) + 1;
  const rows = [];
  models.forEach((m, i) => {
    const cursor = i === sel ? g('▶') : ' ';
    rows.push(`  ${cursor}  ${g(m.label.padEnd(labelW))} ${dg('— ' + m.cost)}`);
    if (i === sel && expanded) {
      rows.push('');
      rows.push(...wrap(`good at: ${m.goodAt}`, width - 8).map((l) => `        ${dim(l)}`));
      rows.push('');
      rows.push(...wrap(`setup: ${m.setup}`, width - 8).map((l) => `        ${dg(l)}`));
      rows.push('');
    } else {
      rows.push(...wrap(`good at: ${m.goodAt}`, width - 8).map((l) => `        ${dim(l)}`));
    }
  });
  return rows;
}

// "These are your folders" step: one folder per line, but more than 8 top-level
// folders wrap into a 2-column grid so it never reads as a long single list. The
// grid falls back to one column when the terminal is too narrow to hold two.
function folderGrid(dirs, width) {
  const cell = (d) => `  ${dim('·')}  ${g(d)}`;
  if (dirs.length <= 8) return dirs.map(cell);
  const half = Math.ceil(dirs.length / 2);
  const left = dirs.slice(0, half);
  const right = dirs.slice(half);
  const colW = Math.max(...left.map((d) => visLen(cell(d)))) + 4;
  const maxW = Math.max(20, width);
  if (colW * 2 > maxW) return dirs.map(cell);
  const out = [];
  for (let i = 0; i < half; i++) {
    const l = cell(left[i]);
    const r = right[i] ? cell(right[i]) : '';
    out.push(l + ' '.repeat(Math.max(0, colW - visLen(l))) + r);
  }
  return out;
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
        ...wrapParas(sanitize(t.body || ''), w - 10).map((l) => `  ${l}`),
        '',
        ...modelRows(t.models, state, w - 10),
        '',
        `  ${dim('Press ENTER to expand a model — press it again to keep walking.')}`,
        '',
        `  ${dim('Any word you don\'t know — press g and I\'ll explain it.')}`,
      ]
    : [
        `  ${g('▶')}  ${g(t.title)}`,
        '',
        ...wrapParas(sanitize(t.body), w - 10).map((l) => `  ${l}`),
        ...(t.folders && t.folders.length ? ['', ...folderGrid(t.folders, w - 10)] : []),
        ...(t.files?.[0] ? ['', `  (file: ${dim(t.files[0].split('/').pop())} — press ${g('o')} to open)`] : []),
        ...(s?.explain ? ['', ...wrap(s.explain, w - 10).map((l) => `  ${dim(l)}`)] : []),
        ...(s ? ['', `  Press ${g('t')} to try it — or type a command of your own.`] : []),
        '',
        `  ${dim('Any word you don\'t know — press g and I\'ll explain it.')}`,
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
    if (key === 'left' || key === 'b') return { ...state, step: Math.max(0, state.step - 1), modelDetail: null };
    if (key === 'g') return { to: 'glossary' };
    if (key === 'q') return { done: true };
    return state;
  }
  // ← or b returns to the previous step (clamped at 0) — the consistent "back" affordance.
  if (key === 'left' || key === 'b') return { ...state, step: Math.max(0, state.step - 1) };
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
    if (s) return { to: 'try', params: { ...s, back: 'tour', tourStep: state.step } };
    return state;
  }
  if (key === 'g') return { to: 'glossary' };   // the hints advertise it; make it real
  if (key === 'q') return { done: true };
  return state;
}
