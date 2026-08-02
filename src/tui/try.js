// src/tui/try.js
// "Try it" — runs ONE appwalk-chosen command and shows its output in a framed box.
// This is the single sanctioned I/O screen in the TUI: the command + args always come
// from appwalk's own allowlist below (never user input), so execFile with an args
// array (no shell, no injection) is safe. Enter/q returns to the caller (the tour).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { box, dim, g, sanitize } from './kit.js';
const exec = promisify(execFile);

// appwalk's allowed "try it" commands, keyed by detected stack. Each is a tiny,
// side-effect-free command a beginner can run to feel what their stack does.
// `peek` shows the app's own config; `run` runs a real (harmless) program.
const ALLOWLIST = {
  node: {
    peek: { cmd: 'cat', args: ['package.json'], label: 'cat package.json — read your app\'s "menu"' },
    run: { cmd: 'node', args: ['-e', 'console.log(1+1)'], label: 'node -e "console.log(1+1)" — run a real program' },
  },
  python: {
    peek: null,
    run: { cmd: 'python', args: ['-c', 'print(2+2)'], label: 'python -c "print(2+2)" — run a real program' },
  },
  static: {
    peek: { cmd: 'cat', args: ['index.html'], label: 'cat index.html — the page your browser reads' },
    run: null,
  },
};

// Every allowlisted [cmd, args] pair, flattened to a set of exact strings. try.init
// re-checks against this before spawning so a future caller can't sneak in an
// arbitrary command — defense in depth, even though the tour only ever passes these.
const ALLOWED = new Set(
  Object.values(ALLOWLIST)
    .flatMap((s) => [s.peek, s.run].filter(Boolean))
    .map((s) => JSON.stringify([s.cmd, s.args.join('\x00')])),
);
const isAllowed = (cmd, args) => ALLOWED.has(JSON.stringify([cmd, (args || []).join('\x00')]));

// The appwalk-chosen "try it" command for a stack/step. The tour tags each step
// ('run' → show a real program executing, 'peek' → read the app's own config), and
// this follows the tag; a step that opens code but has no tag also gets the run demo.
// Null when there's nothing safe to run for the detected stack.
export function suggest(stack, tourStep) {
  const s = ALLOWLIST[stack?.type];
  if (!s) return null;
  if (tourStep?.tags?.includes('run') && s.run) return s.run;
  if (tourStep?.tags?.includes('peek') && s.peek) return s.peek;
  const inCode = tourStep?.files?.[0] && /\.(js|py)$/.test(tourStep.files[0]);
  return inCode && s.run ? s.run : s.peek || s.run || null;
}

// Runs the appwalk-chosen command exactly once, on screen entry (the shell awaits
// this init). Output is captured, never streamed, so the render stays pure.
export const init = async (params = {}) => {
  const { cmd, args, back, label } = params;
  let out = '', err = '', code = 0;
  if (cmd && Array.isArray(args) && isAllowed(cmd, args)) {
    try {
      const res = await exec(cmd, args, { timeout: 10000, maxBuffer: 1 << 20 });
      out = res.stdout || '';
      err = res.stderr || '';
    } catch (e) {
      out = e.stdout || '';
      err = e.stderr || String(e.message || e);
      code = typeof e.code === 'number' ? e.code : 1;
    }
  }
  return { cmd, args, back: back || 'tour', label, out, err, code };
};

export const hints = 'Enter = back to the tour · q = quit';

export function render(state) {
  const cmdLine = [state.cmd, ...(state.args || [])].join(' ');
  const rows = [
    `  ${g('▶')} try it — ${state.label || cmdLine}`,
    '',
    `  ${g('$')} ${sanitize(cmdLine)}`,
    '',
    ...(state.out ? sanitize(state.out).split('\n').filter((l, i, a) => !(l === '' && i === a.length - 1)).map((l) => `  ${l}`) : []),
    ...(state.err ? [`  ${dim(sanitize(state.err))}`] : []),
    ...(state.code ? [`  ${dim(`(exit ${state.code})`)}`] : []),
    '',
    `  That ran on your machine just now —`,
    '  that is what running code feels like.',
    '',
    '  Enter to go back to the tour.',
  ];
  return box('Try it', rows, { width: 'full' });
}

export function step(state, key) {
  if (key === 'enter' || key === 'q') return { to: state.back || 'tour' };
  return state;
}
