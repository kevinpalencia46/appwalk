// src/tui/home.js
import { box, boxWidth, g, dg, dim, visLen, sliceVis } from './kit.js';

// Menu buttons are single-width box/arrow characters — never astral-plane emoji, so
// a terminal without color-emoji fonts renders them instead of the "??" fallback.
// Each button is its own mini-box with an icon, a label, and a one-line description,
// so home reads as a launcher with real buttons, not a list.
export const ITEMS = [
  { to: 'tour', icon: '→', label: 'Take the guided tour', desc: 'Walk your app step by step' },
  { to: 'tree', icon: '▸', label: 'Explore your files', desc: 'Browse every file & folder' },
  { to: 'audit', icon: '!', label: 'Audit for safety & junk', desc: 'Find leaks, clutter & risks' },
  { to: 'ask', icon: '?', label: 'Ask about a file', desc: 'Explain any file plainly' },
  { to: 'glossary', icon: '»', label: 'Learn the words', desc: 'Plain-English definitions' },
  { to: 'flow', icon: '↦', label: 'See how it fits together', desc: 'Map how the pieces connect' },
];

// Launcher grid: 6 buttons in a clean 3×2 grid (3 rows of 2 — no center straggler
// like the old 5-item 2-2-1 layout). 2D arrows move between buttons, Enter activates.
const COLS = 2;
const ROWS = Math.ceil(ITEMS.length / COLS);
const idx = (r, c) => r * COLS + c;
const ok = (r, c) => idx(r, c) >= 0 && idx(r, c) < ITEMS.length;

export const init = (params = {}) => ({ r: 0, c: 0, celebrate: !!params.celebrate });
export const hints = '←↑↓→ move · ENTER choose · q = quit';

// 2D arrow navigation over the button grid. Left/right wrap within a row; up/down
// move to the nearest button in the neighbouring row (same column, then the one to
// its left), wrapping top↔bottom. Pure: returns the next state.
function move(state, dr, dc) {
  const r0 = state.r, c0 = state.c;
  if (dc !== 0) {
    for (let k = 1; k <= COLS; k++) {
      const cc = (c0 + dc * k + COLS) % COLS;
      if (ok(r0, cc)) return { ...state, c: cc };
    }
    return state;
  }
  for (let k = 1; k <= ROWS; k++) {
    const rr = (r0 + dr * k + ROWS) % ROWS;
    for (let s = 0; s < COLS; s++) {
      const cc = (c0 - s + COLS) % COLS;
      if (ok(rr, cc)) return { ...state, r: rr, c: cc };
    }
  }
  return state;
}

// A launcher button: its own mini-box. The active button's frame turns bright
// green and it gains a ▶ cursor on its first line.
function buttonBox(item, active, width) {
  const frame = active ? g : dg;
  const contentW = width - 4;
  const row = (s) => {
    let str = String(s);
    if (visLen(str) > contentW) str = sliceVis(str, contentW);
    return frame('│ ') + str + ' '.repeat(Math.max(0, contentW - visLen(str))) + frame(' │');
  };
  const top = frame('┌') + '─'.repeat(width - 2) + frame('┐');
  const bottom = frame('└') + '─'.repeat(width - 2) + frame('┘');
  const cursor = active ? g('▶') : ' ';
  const lines = [
    row(` ${cursor}  ${g(item.icon)}  ${g(item.label)}`),
    row(`     ${dim(item.desc)}`),
  ];
  return [top, ...lines, bottom].join('\n');
}

export function render(state, { root }) {
  const name = root.split('/').filter(Boolean).pop() || root;
  const btnW = Math.floor((boxWidth('full') - 6) / 2);
  const buttons = ITEMS.map((it, i) => buttonBox(it, idx(state.r, state.c) === i, btnW).split('\n'));
  const side = (a, b) => {
    const n = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = a[i] ?? ' '.repeat(btnW);
      const y = b[i] ?? ' '.repeat(btnW);
      out.push(x + '  ' + y);
    }
    return out;
  };
  const header = `   ${g('★ ' + name.toUpperCase())}${state.celebrate ? `   ${g('★ You did it!')}` : ''}`;
  const rows = [header, ''];
  for (let i = 0; i < buttons.length; i += 2) {
    if (i > 0) rows.push('');
    // pairs lay out side by side; a lone trailing button centers under the columns
    if (i + 1 < buttons.length) rows.push(...side(buttons[i], buttons[i + 1]));
    else rows.push(...buttons[i].map((l) => ' '.repeat(Math.floor((btnW + 2) / 2)) + l));
  }
  return box('appwalk', rows, { width: 'full' });
}

export function step(state, key) {
  if (key === 'down') return move(state, 1, 0);
  if (key === 'up') return move(state, -1, 0);
  if (key === 'right') return move(state, 0, 1);
  if (key === 'left') return move(state, 0, -1);
  if (key === 'enter') return { to: ITEMS[idx(state.r, state.c)].to };
  if (key === 'q') return { done: true };
  return state;
}
