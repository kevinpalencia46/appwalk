// src/tui/home.js
import { box, g } from './kit.js';

// Menu glyphs are single-width box/arrow characters — never astral-plane emoji, so
// a terminal without color-emoji fonts renders them instead of the "??" fallback.
// (The character itself is being redrawn in Procreate; when it lands, mascot.js
// renders it and home stays a name + 5 choices + hint bar.)
export const ITEMS = [
  { to: 'tour', icon: '→', label: 'Take the guided tour' },
  { to: 'tree', icon: '▸', label: 'Explore your files' },
  { to: 'audit', icon: '!', label: 'Audit for safety & junk' },
  { to: 'ask', icon: '?', label: 'Ask about a file' },
  { to: 'glossary', icon: '»', label: 'Learn the words' },
];

export const init = (params = {}) => ({ sel: 0, celebrate: !!params.celebrate });
export const hints = '↑↓ move · ENTER choose · q = quit';

export function render(state, { root }) {
  const name = root.split('/').filter(Boolean).pop() || root;
  const choices = ITEMS.map((it, i) =>
    `   ${i === state.sel ? g('▶') : ' '}  ${it.icon}  ${it.label}`);
  const rows = [
    `   ${g('★ ' + name.toUpperCase())}${state.celebrate ? `   ${g('★ You did it!')}` : ''}`,
    ...choices,
  ];
  return box('appwalk', rows, { width: 'full' });
}

export function step(state, key) {
  if (key === 'down') return { ...state, sel: Math.min(ITEMS.length - 1, state.sel + 1) };
  if (key === 'up') return { ...state, sel: Math.max(0, state.sel - 1) };
  if (key === 'enter') return { to: ITEMS[state.sel].to };
  if (key === 'q') return { done: true };
  return state;
}
