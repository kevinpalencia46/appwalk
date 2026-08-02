// src/tui/audit.js — per-category checklist with a finding-detail view.
// Product-brief rules: findings render as a checklist with a score, never a wall of
// red; every finding carries a fix shown right under it; the score + critical finding
// stay in the upper-middle of the screen (score is the box title, first line inside).
import { box, g, dg, r, dim, sanitize, wrap, W } from './kit.js';
import { CATEGORIES, categoryOf, cleanCount } from '../audit/index.js';

// Display labels for the five audit categories, secrets first (critical findings
// surface before the rest).
const LABELS = { secrets: 'Secrets', duplicates: 'Duplicates', clutter: 'Clutter', deps: 'Dependencies', git: 'Git hygiene' };

// Plain-language glossary term to link from a finding's detail view.
const GLOSSARY_OF = {
  stripe_live: 'API key', aws: 'API key', github: 'API key', google: 'API key', slack: 'API key',
  private_key: 'API key', db_url: 'environment variable', generic_key: 'API key',
  env_in_git: 'environment variable', duplicate: 'refactoring', bak: 'refactoring',
  todo_only: 'refactoring', empty_dir: 'refactoring', missing_lockfile: 'package.json',
  malformed_package_json: 'package.json', unused_dep: 'dependency', uncommitted: 'git',
};
const glossaryFor = (f) => GLOSSARY_OF[f.kind] || 'refactoring';

export const init = () => ({ cursor: 0, catCursor: 0, open: null, detail: null });
export const hints = '↑↓ move · ENTER expand · c = copy ask-your-AI · h = home · q = quit';

// A copy-ready "ask your AI" prompt for a finding, framed so a beginner can hand it
// to any AI assistant (or type it themselves) and get walked through the fix.
// Includes the finding's kind, file, and line so the AI has exactly what it needs.
export const askYourAI = (f) =>
  `I have a leaked ${f.kind} in ${f.file}${f.line ? ':' + f.line : ''}. Walk me through rotating it, gitignoring .env, and cleaning up.`;

// The finding currently open in the detail view (pure, for the shell's `c` copy key).
export const currentFinding = (state, data) => {
  if (state.detail === null || state.open === null) return null;
  const finds = (data?.findings) || [];
  return (groupByCategory(finds)[state.open] || [])[state.detail] || null;
};

// Best-effort clipboard copy: try xclip then wl-copy, degrade silently if neither
// exists (the ask-your-AI line is always on screen for copying by eye regardless).
// The prompt is written to the child's stdin (xclip/wl-copy both read their payload
// from stdin); spawn — never a shell — so nothing user-shaped reaches a shell string.
export async function copyPrompt(prompt) {
  const { spawn } = await import('node:child_process');
  const candidates = [['xclip', ['-selection', 'clipboard']], ['wl-copy', []]];
  for (const [cmd, args] of candidates) {
    const ok = await new Promise((resolve) => {
      let child;
      try { child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] }); }
      catch { resolve(false); return; }
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => { try { child.kill(); } catch {} finish(false); }, 3000);
      timer.unref?.();
      child.on('error', () => finish(false));
      child.on('close', () => { clearTimeout(timer); finish(true); });
      try {
        child.stdin.on('error', () => {});
        child.stdin.write(String(prompt));
        child.stdin.end();
      } catch { finish(false); }
    });
    if (ok) return true;
  }
  return false;
}

const groupByCategory = (finds) => {
  const groups = {};
  for (const c of CATEGORIES) groups[c] = [];
  for (const f of finds) (groups[categoryOf(f)] ||= []).push(f);
  return groups;
};

const findingSummary = (f) => (f.label || f.reason || f.kind).slice(0, 36);

function renderCategoryRows(groups, catCursor) {
  return CATEGORIES.map((c, i) => {
    const list = groups[c] || [];
    const isClean = list.length === 0;
    // Red stays strictly on secrets with findings; everything else is phosphor green
    // (clean) or dim green (secondary findings).
    const mark = isClean ? g('✓') : (c === 'secrets' ? r('✗') : dg('✗'));
    const summary = isClean
      ? '0 findings — clean'
      : `${list.length} finding${list.length === 1 ? '' : 's'} — ${findingSummary(list[0])}${list.length > 1 ? ' …' : ''}`;
    return `  ${i === catCursor ? g('▶') : ' '} ${mark}  ${g(LABELS[c] || c)}  ${dim(summary)}`;
  });
}

function renderFindingRows(catKey, list, cursor) {
  const rows = list.map((f, i) => {
    // Secrets findings are red; findings in other categories are secondary (dim green).
    const mark = catKey === 'secrets' ? r('⚠') : dg('⚠');
    const where = `${sanitize(f.file)}${f.line ? ':' + f.line : ''}`;
    return `  ${i === cursor ? g('▶') : ' '} ${mark}  ${where}  ${findingSummary(f)}`;
  });
  return [`  ${dim('← back to categories · Enter for detail')}`, '', ...rows];
}

function renderDetail(f) {
  if (!f) return box('Finding', ['  (no finding) (FAQ: audit)']);
  const prompt = askYourAI(f);
  const inner = Math.max(20, Math.min(100, W()) - 20);
  const promptLines = wrap(prompt, inner);
  const fixText = sanitize(f.fix || 'Review this finding and remove the risk.');
  const fixLines = wrap(fixText, inner);
  const lines = [
    `  ${g(f.kind)}  ${sanitize(f.file)}${f.line ? ':' + f.line : ''}`,
    '',
    `  ${f.label || f.reason || ''}`,
    ...(f.snippet ? [`  snippet: ${g(sanitize(f.snippet))}`] : []),
    ...(f.other ? [`  duplicate of: ${sanitize(f.other)} (sim ${f.sim})`] : []),
    '',
    `  ${dg('FIX')}  ${fixLines[0] || ''}`,
    ...fixLines.slice(1).map((l) => `    ${l}`),
    '',
    `  ${g('ask your AI')}: ${promptLines[0] || ''}`,
    ...promptLines.slice(1).map((l) => `    ${l}`),
    '',
    '  Press c to copy this prompt — or copy it by eye.',
    '',
    `  glossary: ${glossaryFor(f)} — press ${g('g')} to open`,
    '',
    '  (Enter to go back)',
  ];
  return box('Finding', lines, { width: 'full' });
}

export function render(state, data) {
  const finds = data.findings || [];
  const groups = groupByCategory(finds);
  const title = `audit — ${cleanCount(finds)} of ${CATEGORIES.length} clean`;

  if (state.detail !== null && state.open !== null) {
    return renderDetail((groups[state.open] || [])[state.detail]);
  }
  if (state.open !== null) {
    return box(title, renderFindingRows(state.open, groups[state.open] || [], state.cursor), { width: 'full' });
  }
  return box(title, renderCategoryRows(groups, state.catCursor), { width: 'full' });
}

export function step(state, key, data) {
  const finds = (data && data.findings) || [];
  const groups = groupByCategory(finds);

  if (state.detail !== null) {
    // Detail view: arrows must not move the list cursor — returning the state unchanged
    // (spread-free) preserves the pre-detail cursor so backing out lands where you left off.
    if (key === 'enter' || key === 'left') return { ...state, detail: null };
    if (key === 'q') return { done: true };
    return state;
  }

  if (state.open !== null) {
    const list = groups[state.open] || [];
    if (key === 'down') return { ...state, cursor: Math.min(Math.max(0, list.length - 1), state.cursor + 1) };
    if (key === 'up') return { ...state, cursor: Math.max(0, state.cursor - 1) };
    if (key === 'enter') return list.length ? { ...state, detail: state.cursor } : state;
    if (key === 'left') return { ...state, open: null };
    if (key === 'q') return { done: true };
    return state;
  }

  if (key === 'down') return { ...state, catCursor: Math.min(CATEGORIES.length - 1, state.catCursor + 1) };
  if (key === 'up') return { ...state, catCursor: Math.max(0, state.catCursor - 1) };
  if (key === 'enter') {
    const c = CATEGORIES[state.catCursor];
    const list = groups[c] || [];
    // Preserve the finding cursor (clamped to the list) so backing out of a detail or
    // category lands where you left off — never jump the user back to the top.
    if (list.length) return { ...state, open: c, cursor: Math.min(state.cursor, list.length - 1) };
    return state; // clean category — nothing to expand
  }
  if (key === 'g') return { to: 'glossary', params: { back: 'audit' } };
  if (key === 'q') return { done: true };
  return state;
}
