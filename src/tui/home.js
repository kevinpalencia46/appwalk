// src/tui/home.js
import { box, g } from './kit.js';
import { MASCOT_STATIC } from './mascot.js';

// Where the mascot sits on screen once the box is painted: row 2 is the first
// content row (row 1 is the box top border), col 6 is the first glyph after the
// `│ ` border plus the 3-space indent. The animation overlay (app.js) rewrites
// exactly these rows.
export const MASCOT_AT = { row: 2, col: 6 };

export const ITEMS = [
  { to: 'tour', icon: '🚶', label: 'Take the guided tour' },
  { to: 'tree', icon: '🗂', label: 'Explore your files' },
  { to: 'audit', icon: '🛡', label: 'Audit for safety & junk' },
  { to: 'ask', icon: '💬', label: 'Ask about a file' },
  { to: 'glossary', icon: '📖', label: 'Learn the words' },
];

export const init = (params = {}) => ({ sel: 0, celebrate: !!params.celebrate });
export const hints = '↑↓ move · ENTER choose · q = quit';

export function render(state, { root }) {
  const name = root.split('/').filter(Boolean).pop() || root;
  // Compact menu rows so the 14-row mascot + name + choices + hints still fit a
  // 24-row terminal with the hint bar pinned to the bottom row. The mascot's own
  // trailing blank line is the spacing between it and the project name.
  const choices = ITEMS.map((it, i) =>
    `   ${i === state.sel ? g('▶') : ' '}  ${it.icon}  ${it.label}`);
  const rows = [
    ...MASCOT_STATIC.split('\n').map((l) => `   ${l}`),   // 14th row is blank → spacing
    `   ${g('★ ' + name.toUpperCase())}${state.celebrate ? `   ${g('🎉 You did it!')}` : ''}`,
    ...choices,
    `   (${g(hints)})`,
  ];
  return box('appwalk', rows, { width: 'full', height: 'full' });
}

export function step(state, key) {
  if (key === 'down') return { ...state, sel: Math.min(ITEMS.length - 1, state.sel + 1) };
  if (key === 'up') return { ...state, sel: Math.max(0, state.sel - 1) };
  if (key === 'enter') return { to: ITEMS[state.sel].to };
  if (key === 'q') return { done: true };
  return state;
}
