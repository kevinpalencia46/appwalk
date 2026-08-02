// src/flow.js — the flow map: how the app's pieces connect.
//
// Pure, zero-dependency, no AI. Static analysis only (never executes the code):
// start at the entry point and follow imports/requires, HTML <script src>, and
// Express-style route registrations (app.get/post/use(...) -> the handler file)
// to build the backbone. The result is depth- and breadth-capped so a massive
// app still renders a readable map: children beyond `depth` hops from the entry
// (or beyond the per-node breadth cap) collapse into a "+N more" note on the
// parent instead of expanding forever.
//
// # heuristic — this is best-effort static analysis. It resolves only specifiers
// that point at files inside the project (bare npm packages and node builtins are
// skipped), guesses a file's role from its path/name and a few code smells, and
// never crashes on an unknown pattern: a line it doesn't recognize simply
// produces no edge.

import { basename, dirname, join, resolve } from 'node:path';
import { readFileSafe, rel } from './util.js';

const BREADTH_CAP = 6;   // at most this many children render under one node
const EXT = ['', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.json'];

// One-line "what does this file do" shown next to each node in the map.
const ROLE_DESC = {
  entry: 'starts the app',
  route: 'wires requests to handlers',
  handler: 'handles one request',
  data: 'reads & writes data',
  render: 'builds what you see',
  util: 'shared helpers',
  config: 'settings for the app',
};
// Children render in this order (routes first, then handlers, ..., utils last) so
// the "main flow" reads top-down instead of buried under generic helpers.
const ROLE_RANK = { entry: 0, route: 1, handler: 2, data: 3, render: 4, util: 5, config: 6 };

const IMPORT_RE = /import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g;
const SIDE_IMPORT_RE = /import\s*['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /export\s+[^;]+?\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const SCRIPT_RE = /<\s*script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g;
const ROUTE_RE = /\b(?:app|router|route)\s*\.\s*(get|post|put|delete|patch|use|all)\s*\(([^)]*)\)/g;

// identifier -> module mapping from require/import declarations, used to resolve
// `app.get('/x', handler)` where the handler is a bare identifier (const/import).
// Each entry: [regex, namedImport?] — named imports map every listed name to the
// same module (import { a, b } from 'x' binds both a and b to x).
const DECL_REQS = [
  [/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g, false],
  [/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*[\s\S]*?)?\s+from\s+['"]([^'"]+)['"]/g, false],
  [/import\s*\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g, false],
  [/import\s*\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g, true],
];

const ROUTE_FILE_RE = /route/i;
const HANDLER_NAME_RE = /handler/i;
const CONTROLLER_RE = /controller/i;
const ROUTE_CODE_RE = /\b(?:app|router|route)\s*\.\s*(get|post|put|delete|patch|use|all)\s*\(/;
const DATA_RE = /(^|[\/._-])(db|database|models?|schema|store|query|repo|repository|sql|redis)([\/._-]|$)/i;
const RENDER_RE = /(^|[\/._-])(component|view|page|layout)(s?)([\/._-]|$)/i;

export function isConfigName(name) {
  return /(^package\.json$|\.json$|\.ya?ml$|\.toml$|^\.env|\.env$|\.config\.[jt]s$|^tsconfig\.|^vite\.config\.|^Dockerfile$|^Makefile$|^requirements\.txt$|^\.gitignore$|^eslint|^babel\.|^postcss\.|^tailwind\.|^next\.config\.)/.test(name);
}

// Resolve a module specifier to a real project file. Returns null for bare
// packages (express, react, node builtins) — they live in node_modules, which
// walk() skips, so there's no node to map to. `{ bare: true }` relaxes that for
// HTML <script src="app.js">, where a bare name is page-relative, not a package.
function resolveSpec(spec, from, root, byPath, { bare = false } = {}) {
  const s = String(spec || '').trim();
  if (!s) return null;
  if (!bare && !s.startsWith('.') && !s.startsWith('/')) return null;
  const base = s.startsWith('/') ? join(root, s.replace(/^\//, '')) : resolve(dirname(from), s);
  for (const e of EXT) if (byPath.has(base + e)) return base + e;
  const idx = join(base, 'index.js');
  if (byPath.has(idx)) return idx;
  return null;
}

// Remove comments before scanning so commented-out code never looks live: vibe-
// coded apps are full of `// import x from './y'` and `// app.get(...)` lines that
// would otherwise fake edges and roles. JS line/block comments for code files,
// HTML comments for markup; a `//` in `http://` is protected by the [^:] guard.
function stripComments(p, text) {
  let s = String(text);
  if (/\.(html?|htm)$/.test(p)) return s.replace(/<!--[\s\S]*?-->/g, ' ');
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// Pull the positional tokens out of a route call's argument list: quoted strings
// keep their quotes stripped, identifiers keep their names. `app.get('/x', h)` ->
// ['/x', 'h']. Inline callbacks just add their parameter names, which then fail
// the identifier->module lookup and are ignored.
function routeArgs(s) {
  const out = [];
  const re = /'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*)/g;
  for (const m of s.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const isPathLike = (v) => v.startsWith('/') || v.startsWith('.');

// The files a route registration points at: app.get('/x', './handlers/x') where
// the handler is a string path, or app.get('/x', users) where `users` is a
// require()/import bound identifier. Either way the target file becomes a child
// edge and is marked as a route-handler candidate for role guessing.
function routeHandlers(p, text, root, byPath) {
  const idToPath = new Map();
  for (const [re, named] of DECL_REQS) {
    for (const m of text.matchAll(re)) {
      const r = resolveSpec(m[2], p, root, byPath);
      if (!r) continue;
      if (named) {
        for (const nm of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) idToPath.set(nm, r);
      } else {
        idToPath.set(m[1], r);
      }
    }
  }
  const out = [];
  for (const m of text.matchAll(ROUTE_RE)) {
    const method = m[1];
    const args = routeArgs(m[2]);
    let handler = null;
    if (method === 'use') {
      const first = args[0];
      handler = first && isPathLike(first) ? args[1] : first;
    } else if (args[0] && isPathLike(args[0])) {
      handler = args[1];
    }
    if (!handler) continue;
    const r = typeof handler === 'string' && isPathLike(handler)
      ? resolveSpec(handler, p, root, byPath)
      : idToPath.get(handler) || null;
    if (r) out.push(r);
  }
  return out;
}

// The direct children of one file: imports, requires, re-exports, <script src>,
// and route registrations (deduped by the caller).
function scanChildren(p, text, root, byPath, handlerRefs) {
  const kids = [];
  const add = (spec, opts) => {
    const r = resolveSpec(spec, p, root, byPath, opts);
    if (r) kids.push(r);
    return r;
  };
  for (const m of text.matchAll(IMPORT_RE)) add(m[1]);
  for (const m of text.matchAll(SIDE_IMPORT_RE)) add(m[1]);
  for (const m of text.matchAll(EXPORT_FROM_RE)) add(m[1]);
  for (const m of text.matchAll(REQUIRE_RE)) add(m[1]);
  for (const m of text.matchAll(SCRIPT_RE)) add(m[1], { bare: true });
  for (const h of routeHandlers(p, text, root, byPath)) {
    if (h) { kids.push(h); handlerRefs.add(h); }
  }
  return kids;
}

// Role of a file, shared by the flow map (src/flow.js) and the config screen's
// clean-filing suggestions (src/config.js). Best-effort, name/path first, then a
// code smell. flow.js passes isStart/isHandler from its scan context; config.js
// calls it without them and gets a name/path/smell guess.
export function classifyRole(name, path, rel, text = '', opts = {}) {
  if (opts.isStart) return 'entry';
  if (isConfigName(name)) return 'config';
  if (ROUTE_FILE_RE.test(name) || ROUTE_CODE_RE.test(text || '')) return 'route';
  if (opts.isHandler || HANDLER_NAME_RE.test(name) || CONTROLLER_RE.test(rel || '')) return 'handler';
  if (DATA_RE.test(rel || '')) return 'data';
  if (RENDER_RE.test(rel || '') || /\.(jsx|tsx|html)$/.test(path)) return 'render';
  return 'util';
}

function roleOf({ path, name, rel, text, isStart }, handlerRefs) {
  return classifyRole(name, path, rel, text, { isStart, isHandler: handlerRefs.has(path) });
}

// Sort a node's children so the "main flow" reads first, then data, then generic
// helpers — deterministic (stable ties broken by name), which is what the tests
// and the depth/breadth caps depend on.
function sortChildren(kids, info, handlerRefs) {
  const scored = kids.map((p) => {
    const n = info.get(p) || {};
    const role = roleOf({ path: p, name: n.name || basename(p), rel: n.rel || '', text: n.text || '' }, handlerRefs);
    return { p, rank: ROLE_RANK[role] ?? 5 };
  });
  scored.sort((a, b) => a.rank - b.rank || String(info.get(a.p)?.name || '').localeCompare(String(info.get(b.p)?.name || '')));
  return scored.map((s) => s.p);
}

// Find the file the app really starts from. detectStack names package.json for
// node apps, but package.json is config — the actual entry is its `main`, a bin
// target, or a `node <file>` script. Falls back to the first code entry point,
// then to detectStack's entry itself (honest: a static site starts at index.html).
async function resolveStart(map, stack, byPath) {
  const atRoot = (name) => map.flat.find((n) => n.name === name && n.dir === '.') || map.flat.find((n) => n.name === name);
  if (stack?.entry && stack.entry !== 'package.json') {
    const n = atRoot(stack.entry);
    if (n) return n.path;
  }
  if (stack?.type === 'node') {
    const pkgNode = map.flat.find((n) => n.name === 'package.json');
    if (pkgNode) {
      const text = await readFileSafe(pkgNode.path);
      let pkg = null;
      try { pkg = text ? JSON.parse(text) : null; } catch { pkg = null; }
      const mains = [];
      if (typeof pkg?.main === 'string') mains.push(pkg.main);
      if (pkg?.bin) for (const v of Object.values(pkg.bin)) mains.push(String(v));
      for (const v of Object.values(pkg?.scripts || {})) {
        const m = String(v).match(/^(?:node|nodejs)\s+(\S+)/);
        if (m) mains.push(m[1]);
      }
      for (const m of mains) {
        const hit = [join(map.root, m), ...EXT.map((e) => join(map.root, m + e))].find((c) => byPath.has(c));
        if (hit) return hit;
      }
    }
    const codeEntry = map.entryPoints.find((n) => /\.(js|mjs|cjs|ts|jsx|tsx)$/.test(n.name));
    if (codeEntry) return codeEntry.path;
  }
  const n = stack?.entry ? atRoot(stack.entry) : null;
  if (n) return n.path;
  return map.entryPoints[0]?.path || null;
}

/**
 * Build the flow map for a project.
 * @param {object} map        from buildMap(root)
 * @param {object} stack      from detectStack(map)
 * @param {object} opts
 * @param {number} opts.depth how many hops from the entry to expand (default 1)
 * @returns {{ start: string|null, nodes: Array<{path,name,rel,role,more}>, edges: Array<{from,to}>, order: string[] }}
 *   `order` is the display order of nodes (pre-order; formatFlow emits one line per
 *   entry), and node.more is how many of that node's children collapsed into a
 *   "+N more" note (beyond depth, or beyond the per-node breadth cap).
 */
export async function buildFlow(map, stack, { depth = 1 } = {}) {
  const byPath = new Map(map.flat.map((n) => [n.path, n]));
  const start = await resolveStart(map, stack, byPath);
  const info = new Map();        // path -> { path, name, rel, text }
  const children = new Map();    // path -> [childPath]
  const handlerRefs = new Set();
  const maxDepth = Math.max(1, depth ?? 1);

  if (start && byPath.has(start)) {
    // Depth-aware scan: read only the files that can influence the map at this
    // depth — the entry plus every node within maxDepth hops. Children at
    // maxDepth+1 hops and beyond are still recorded as child edges off their parent
    // (so the "+N more" count stays honest) but their files are never read: a
    // massive app's far reaches don't get regex-scanned just because you asked for
    // a depth-1 backbone.
    const queue = [{ p: start, d: 0 }];
    const seen = new Set([start]);
    while (queue.length) {
      const { p, d } = queue.shift();
      const text = stripComments(p, (await readFileSafe(p)) || '');
      const meta = byPath.get(p) || {};
      info.set(p, { path: p, name: meta.name || basename(p), rel: rel(map.root, p), text });
      children.set(p, [...new Set(scanChildren(p, text, map.root, byPath, handlerRefs))]);
      if (d >= maxDepth) continue;   // deeper children are counted, not scanned
      for (const k of children.get(p)) {
        if (!seen.has(k)) { seen.add(k); queue.push({ p: k, d: d + 1 }); }
      }
    }
  }

  for (const [p, kids] of children) children.set(p, sortChildren(kids, info, handlerRefs));
  return trim(info, children, handlerRefs, start, depth);
}

// BFS from the entry, claiming each node's first <=6 within-depth children. A node
// claimed by the first (shortest-path) parent appears once in the tree; the rest
// of a parent's children collapse into its "+N more" count.
function trim(info, children, handlerRefs, start, depth) {
  const maxDepth = Math.max(1, depth ?? 1);
  if (!start || !info.has(start)) return { start: start || null, nodes: [], edges: [], order: [] };

  const dist = new Map([[start, 0]]);
  const shown = new Set([start]);
  const edges = [];
  const queue = [start];
  while (queue.length) {
    const p = queue.shift();
    const d = dist.get(p);
    if (d + 1 > maxDepth) continue;              // everything below is hidden
    let claimed = 0;
    for (const k of children.get(p) || []) {
      if (claimed >= BREADTH_CAP) break;
      if (shown.has(k)) continue;                // shown under its first parent
      shown.add(k);
      dist.set(k, d + 1);
      edges.push({ from: p, to: k });
      queue.push(k);
      claimed++;
    }
  }

  const kidsOf = new Map();
  for (const e of edges) {
    const a = kidsOf.get(e.from) || [];
    a.push(e.to);
    kidsOf.set(e.from, a);
  }
  const order = [];
  const walk = (p) => { order.push(p); for (const k of kidsOf.get(p) || []) walk(k); };
  walk(start);

  const nodes = order.map((p) => {
    const n = info.get(p) || {};
    return {
      path: p,
      name: n.name || basename(p),
      rel: n.rel || '',
      role: roleOf({ path: p, name: n.name || basename(p), rel: n.rel || '', text: n.text || '', isStart: p === start }, handlerRefs),
      more: (children.get(p) || []).filter((k) => !shown.has(k)).length,
    };
  });
  return { start, nodes, edges, order };
}

/**
 * Render the flow as a navigable ASCII tree. Returns one line per node, in
 * `flow.order` (pre-order) — the flow screen's cursor is a straight index into
 * those lines. The entry is marked `● start`, each node shows its relative path
 * + a one-line role, and collapsed children appear as `(+N more)` on the parent.
 * @param {object} flow from buildFlow(map, stack, { depth })
 * @param {object} opts
 * @param {number} opts.depth current depth (informational — the tree layout is
 *   already trimmed to the depth the flow was built with)
 */
export function formatFlow(flow, { depth } = {}) {
  if (!flow || !flow.order?.length) return ['   (no files — nothing to map)'];
  const byPath = new Map(flow.nodes.map((n) => [n.path, n]));
  const kidsOf = new Map();
  for (const e of flow.edges || []) {
    const a = kidsOf.get(e.from) || [];
    a.push(e.to);
    kidsOf.set(e.from, a);
  }
  const lines = [];
  const walk = (p, prefix, isLast) => {
    const node = byPath.get(p) || {};
    const isRoot = p === flow.start;
    const conn = isRoot ? '' : (isLast ? '└─→ ' : '├─→ ');
    lines.push(prefix + conn + nodeLabel(node, p, flow, isRoot));
    const childPrefix = prefix + (isRoot ? '' : (isLast ? '    ' : '│   '));
    const kids = kidsOf.get(p) || [];
    kids.forEach((k, i) => walk(k, childPrefix, i === kids.length - 1));
  };
  walk(flow.start, '', true);
  return lines;
}

function nodeLabel(node, p, flow, isRoot) {
  const name = node.rel || node.name || p;
  const desc = ROLE_DESC[node.role] || node.role || 'file';
  const startMark = isRoot ? '● start → ' : '';
  const more = node.more ? `  (+${node.more} more)` : '';
  return `${startMark}${name} — ${desc}${more}`;
}
