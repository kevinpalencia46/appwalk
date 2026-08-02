// src/tui/config.js — the "Your setup" screen.
//
// Two views, switched by 1 / 2:
//   View 1 (Settings) — the project's config files as a list; Enter opens a
//     detail card (what it controls · how yours is set · why · you could also…).
//   View 2 (Clean it up) — role-grouped filing suggestions grounded in THIS
//     project, plus best-practice tips and a pointer to the clutter audit.
//
// Pure render/step — data comes from data.config (lazy-built + memoized by the
// shell) so the screen never does I/O.
import { box, g, dim, wrap, W, sanitize } from './kit.js';

export const init = (params = {}) => ({ view: 1, cursor: 0, detail: null, back: params.back || 'home' });
export const hints = '1 settings · 2 clean up · ↑↓ move · Enter open · q back';

function detailLines(file) {
  const lines = [`  ${g(sanitize(file.what))}`];
  for (const s of file.settings || []) {
    lines.push('', `  ${g(sanitize(s.key))}: ${sanitize(s.value)}`);
    lines.push(`      why: ${sanitize(s.why)}`);
    lines.push(`      you could also: ${sanitize(s.alternatives)}`);
  }
  if (file.note) lines.push('', `  ${dim(sanitize(file.note))}`);
  return lines.flatMap((l) => (l ? wrap(l, Math.max(30, W() - 8)) : ['']));
}

function renderSettings(state, cfg) {
  const files = cfg.files || [];
  if (!files.length) return box('Your setup — settings', ['', '  No config files found.', '', '  (most projects have at least a package.json', '  or a .gitignore)', ''], { width: 'full' });
  if (state.detail) {
    return box(`Your setup — ${sanitize(state.detail.name)}`, ['', ...detailLines(state.detail), ''], { width: 'full' });
  }
  const cursor = Math.min(state.cursor, Math.max(0, files.length - 1));
  const rows = files.map((f, i) => `  ${i === cursor ? g('▶') : ' '}  ${g(sanitize(f.name))}${dim(' — ' + sanitize(f.what).slice(0, 40))}`);
  return box('Your setup — settings', ['', ...rows, ''], { width: 'full' });
}

function renderClean(cfg, findings) {
  const { groups = [], tips = [] } = cfg.filing || {};
  const clutter = (findings || []).filter((f) => f.category === 'clutter').length;
  const lines = [];
  if (!groups.length) {
    lines.push('  Nothing to tidy — every role is already one folder or under 3 files.', '');
  }
  for (const grp of groups) {
    lines.push(`  ${g('▶')} ${g(sanitize(grp.label))} — ${sanitize(grp.suggestion || grp.note)}`);
    for (const f of grp.files) lines.push(`     ${dim(sanitize(f.rel))}`);
    lines.push('');
  }
  lines.push(`  ${g('Keep it tidy')}`);
  for (const t of tips) lines.push(`   • ${dim(t)}`);
  lines.push('');
  const clutterLine = findings == null
    ? `  ${dim('Run the Audit screen to check for clutter (backups, empty folders, TODO files).')}`
    : clutter > 0
      ? `  ${dim(`${clutter} clutter finding${clutter === 1 ? '' : 's'} — open the Audit screen for the specifics.`)}`
      : `  ${dim('No clutter findings — the Audit screen checks backups, empty folders and TODO files.')}`;
  lines.push(clutterLine);
  return box('Your setup — clean it up', lines, { width: 'full' });
}

export function render(state, data = {}) {
  const cfg = data.config;
  if (!cfg) return box('Your setup', ['', '  No config data yet.', ''], { width: 'full' });
  return state.view === 2 ? renderClean(cfg, data.findings) : renderSettings(state, cfg);
}

export function step(state, key, data = {}) {
  const files = (data.config?.files) || [];
  const max = Math.max(0, files.length - 1);
  if (state.detail) {
    if (key === 'left' || key === 'q') return { ...state, detail: null };
    return state;
  }
  if (key === '1') return { ...state, view: 1 };
  if (key === '2') return { ...state, view: 2 };
  if (state.view === 2) {
    if (key === 'q') return state.back ? { to: state.back } : { done: true };
    return state;
  }
  if (key === 'down') return { ...state, cursor: Math.min(max, state.cursor + 1) };
  if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (key === 'enter' && files.length) return { ...state, detail: files[Math.min(state.cursor, max)] };
  if (key === 'q') return state.back ? { to: state.back } : { done: true };
  return state;
}
