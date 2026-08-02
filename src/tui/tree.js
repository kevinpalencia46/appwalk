// src/tui/tree.js
import { box, g, dg, dim, inv } from './kit.js';

export function buildFolderTree(flat) {
  const root = [];
  const dirs = new Map();          // path -> dir node
  const mkDir = (parts) => {
    let cur = root;
    let acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      let node = cur.find((n) => n.name === p && n.type === 'dir');
      if (!node) { node = { name: p, path: acc, type: 'dir', children: [] }; cur.push(node); }
      cur = node.children;
    }
  };
  for (const f of flat) {
    const parts = (f.dir || '').split('/').filter(Boolean);
    if (parts.length) { mkDir(parts); }
    const parent = parts.length
      ? (() => { let cur = root; let acc = ''; for (const p of parts) { acc = acc ? acc + '/' + p : p; cur = cur.find((n) => n.type === 'dir' && n.name === p).children; } return cur; })()
      : root;
    parent.push({ name: f.name, path: f.path, type: 'file', dir: f.dir, lang: f.lang, size: f.size, entry: f.entry });
  }
  return root;
}

export const init = () => ({ cursor: 0, expanded: new Set(), showAudit: false });
export const hints = '↑↓ move · ←/→ collapse · Enter open · a audit · q quit';

function flatten(tree, expanded, depth = 0) {
  const out = [];
  for (const n of tree) {
    if (n.type === 'dir') {
      out.push({ ...n, depth, open: expanded.has(n.path) });
      if (expanded.has(n.path)) out.push(...flatten(n.children, expanded, depth + 1));
    } else out.push({ ...n, depth });
  }
  return out;
}

export function render(state, data) {
  const tree = data.tree ?? buildFolderTree(data.map.flat);
  const rows = flatten(tree, state.expanded).map((n, i) => {
    const pad = '  '.repeat(n.depth);
    let line;
    if (n.type === 'dir') {
      line = `  ${pad}${state.expanded.has(n.path) ? '▾' : '▸'} ${g(n.name)}/   (${n.children.length} item${n.children.length === 1 ? '' : 's'})`;
    } else {
      const mark = n.entry ? g('●') : ' ';
      const meta = `${n.lang} · ${fmt(n.size)}`;
      line = `  ${pad}${mark} ${n.name.padEnd(18)}${dim(meta)}`;
    }
    return i === state.cursor ? inv(line) : line;
  });
  const hasEnv = data.map.hasEnv;
  const envRows = hasEnv
    ? ['', '  ▸ .env — location only', `     ${dim('why: holds secrets (API keys, passwords).')}`, `     ${dim('Keep it gitignored — commit it and anyone can read them.')}`]
    : [];
  // Legend: the green dot marks where the app starts, a plain name is a regular
  // file. Renders dim so it stays the quietest thing on the tree screen.
  const legend = `  ${g('●')} ${dim('= entry point (where the app starts)')} · ${dim('plain = a regular file')}`;
  return box(data.root.split('/').filter(Boolean).pop() || 'app', [...rows, ...envRows, '', legend], { height: 'full' });
}
const fmt = (n) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

export function step(state, key, data) {
  const tree = data.tree ?? buildFolderTree(data.map.flat);
  const rows = flatten(tree, state.expanded);
  const n = rows[state.cursor];
  if (key === 'down') return { ...state, cursor: Math.min(rows.length - 1, state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'right' && n?.type === 'dir') { const e = new Set(state.expanded); e.add(n.path); return { ...state, expanded: e }; }
  if (key === 'left' && n?.type === 'dir') { const e = new Set(state.expanded); e.delete(n.path); return { ...state, expanded: e }; }
  if (key === 'enter' && n?.type === 'file') return { to: 'viewer', params: { file: n.path, mode: 'view', back: 'tree' } };
  if (key === 'a') return { ...state, showAudit: !state.showAudit };
  if (key === 'q') return { done: true };
  return state;
}
