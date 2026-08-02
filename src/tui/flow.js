// src/tui/flow.js — the flow map screen ("See how it fits together").
//
// Renders formatFlow's ASCII tree in a framed box. The cursor moves between
// nodes (line i of the render is node i of flow.order — formatFlow emits exactly
// one line per node), Enter opens the node in the viewer, and +/− re-builds the
// flow at a different depth (the shell memoizes one flow per depth in
// data.flowCache, so render/step stay pure and cheap).
import { box, g, dim, inv } from './kit.js';
import { formatFlow } from '../flow.js';

export const MAX_DEPTH = 8;   // deeper than this is noise for a beginner

export const init = (params = {}) => ({ cursor: 0, depth: params.depth || 1, back: params.back || 'home' });
export const hints = '↑↓ move · Enter open · +/- depth · h home · q back';

// The flow for the current depth. Prefer the per-depth cache; fall back to a
// single prebuilt data.flow so a caller that built one flow still renders.
const flowFor = (data, depth) => data?.flowCache?.[depth] || data?.flow;

export function render(state, data = {}) {
  const depth = state.depth || 1;
  const flow = flowFor(data, depth);
  if (!flow?.order?.length) {
    return box('How it fits together', ['', '  No entry point found — nothing to map.', '', '  (a package.json, index.js, or main.py', '  tells me where your app starts)', ''], { width: 'full' });
  }
  const lines = formatFlow(flow, { depth });
  const idx = Math.min(Math.max(0, state.cursor || 0), flow.order.length - 1);
  // Window the tree around the cursor so a deep map never scrolls it off-screen;
  // box() caps the frame at terminal height either way.
  const WINDOW = Math.max(5, (process.stdout.rows || 24) - 6);
  const start = lines.length > WINDOW ? Math.max(0, Math.min(idx - Math.floor(WINDOW / 2), lines.length - WINDOW)) : 0;
  const shown = lines.slice(start, start + WINDOW).map((l, i) => (start + i === idx ? inv(l) : l));
  const footer = `  ${dim(`depth ${depth} · ${flow.order.length} file${flow.order.length === 1 ? '' : 's'} mapped`)}`;
  return box('How it fits together', [...shown, '', footer], { width: 'full', height: 'full' });
}

export function step(state, key, data = {}) {
  const flow = flowFor(data, state.depth || 1);
  const n = flow?.order?.length || 0;
  if (key === 'down') return { ...state, cursor: Math.min(Math.max(0, n - 1), (state.cursor || 0) + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, (state.cursor || 0) - 1) };
  if (key === 'enter' && n) {
    const p = flow.order[Math.min(state.cursor || 0, n - 1)];
    return { to: 'viewer', params: { file: p, mode: 'view', back: 'flow' } };
  }
  // +/− re-map at a new depth. Shrinking the depth shrinks the tree, so a cursor
  // that sat near the bottom of the old tree would point past the new last row;
  // clamp it to the new order length so the highlight never freezes off-screen.
  if (key === '+' || key === '-') {
    const depth = key === '+'
      ? Math.min(MAX_DEPTH, (state.depth || 1) + 1)
      : Math.max(1, (state.depth || 1) - 1);
    const f = flowFor(data, depth);
    const m = f?.order?.length || 0;
    return { ...state, depth, cursor: Math.min(Math.max(0, state.cursor || 0), Math.max(0, m - 1)) };
  }
  if (key === 'q') return state.back ? { to: state.back } : { done: true };
  return state;
}
