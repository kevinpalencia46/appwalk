import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename, extname, relative } from 'node:path';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function humanSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const LANG = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java', php: 'php',
  html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'md',
  sql: 'sql', sh: 'sh', yml: 'yml', yaml: 'yml', toml: 'toml', env: 'env',
};
export const langOf = (p) => LANG[extname(p).replace(/^\./, '').toLowerCase()] || 'text';

export async function readIgnore(root) {
  try {
    const raw = await readFile(join(root, '.gitignore'), 'utf8');
    return raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch { return []; }
}

const ALWAYS_SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.venv', 'venv', '__pycache__', '.superpowers']);

function ignored(rel, patterns) {
  return patterns.some((p) => {
    const base = p.replace(/^\/+|\/+$/g, '');
    const b = base.replace(/\*/g, '[^/]*');
    // A gitignore line can contain regex metacharacters (e.g. `foo[bar`) that make
    // `new RegExp` throw — fall back to a plain substring match rather than crashing.
    let re;
    try { re = new RegExp('^' + b + '$'); } catch { re = null; }
    return rel === base || rel.startsWith(base + '/') || rel.endsWith('/' + base) || (re ? re.test(rel) : rel.includes(base));
  });
}

export async function walk(root, _seen = new Set()) {
  const patterns = await readIgnore(root);
  const out = [];
  async function rec(dir) {
    let ents;
    try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = join(dir, e.name);
      const relp = relative(root, abs).split('/').join('/');
      // Skip standard/ignored dirs and dotfiles at ANY depth, not just the top level
      // (e.g. src/node_modules or nested dist/).
      const parts = relp.split('/');
      if (parts.some((seg) => ALWAYS_SKIP.has(seg) || seg.startsWith('.'))) continue;
      if (ignored(relp, patterns)) continue;
      if (e.isDirectory()) await rec(abs);
      else if (e.isFile()) out.push(abs);
    }
  }
  await rec(root);
  return out.sort();
}

export const rel = (root, abs) => relative(root, abs);

export async function readFileSafe(abs) {
  try { return await readFile(abs, 'utf8'); } catch { return null; }
}
