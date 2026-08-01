// src/tui/home.js
import { box, g, b } from './kit.js';

export const ITEMS = [
  { to: 'tour', icon: '🚶', label: 'Take the guided tour' },
  { to: 'tree', icon: '🗂', label: 'Explore your files' },
  { to: 'audit', icon: '🛡', label: 'Audit for safety & junk' },
  { to: 'ask', icon: '💬', label: 'Ask about a file' },
  { to: 'glossary', icon: '📖', label: 'Learn the words' },
];

export const init = () => ({ sel: 0 });
export const hints = 'arrows move · Enter choose · q quit';

export function render(state, { root }) {
  const name = root.split('/').filter(Boolean).pop() || root;
  const rows = [
    '   👋  Hi! I\'ll help you understand your app.',
    `      Looking at:  ${b(name)}`,
    '',
    ...ITEMS.map((it, i) => `   ${i === state.sel ? g('▶') : ' '}  ${it.icon}  ${it.label}`),
    '',
    `   (${g(hints)})`,
  ];
  return box('appwalk', rows);
}

export function step(state, key) {
  if (key === 'down') return { ...state, sel: Math.min(ITEMS.length - 1, state.sel + 1) };
  if (key === 'up') return { ...state, sel: Math.max(0, state.sel - 1) };
  if (key === 'enter') return { to: ITEMS[state.sel].to };
  if (key === 'q') return { done: true };
  return state;
}
