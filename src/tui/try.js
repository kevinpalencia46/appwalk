// src/tui/try.js
// "Try it" — the ONE place in the TUI where a real command runs. On entry the box
// opens BELOW the tour step you came from, with appwalk's suggested command pre-filled
// in an editable line. The user can edit it or type their own; Enter runs it. Output is
// captured, never streamed, so the render stays pure.
//
// SECURITY: execFile with an args array (never a shell) already blocks shell-string
// injection, so a `; rm -rf /` can't chain anything. The danger denylist below is the
// second gate: it refuses typed commands that are destructive even as a single program
// (rm/sudo/mkfs/dd/shutdown/reboot, redirects, chaining/pipes into a shell, $()/backticks,
// chmod/chown, fetch-and-run wget/curl). appwalk's own suggested commands always pass.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { box, boxWidth, g, dim, sanitize, wrap, wrapParas } from './kit.js';
const exec = promisify(execFile);

// appwalk's suggested "try it" commands, keyed by detected stack. Each is a tiny,
// side-effect-free command a beginner can run to feel what their stack does.
// `peek` shows the app's own config; `run` runs a real (harmless) program. `explain`
// is the plain-words "what does this command do" line the tour shows before inviting
// the beginner to press t.
const ALLOWLIST = {
  node: {
    peek: { cmd: 'cat', args: ['package.json'], label: 'cat package.json — read your app\'s "menu"', explain: 'to see what\'s inside package.json we use the command `cat` — it stands for "concatenate" and it just prints a file\'s contents on screen.' },
    run: { cmd: 'node', args: ['-e', 'console.log(1+1)'], label: 'node -e "console.log(1+1)" — run a real program', explain: 'this runs a real program: `node` is the program that runs JavaScript, and `-e` means "evaluate this code". This one just prints 1+1.' },
  },
  python: {
    peek: null,
    run: { cmd: 'python', args: ['-c', 'print(2+2)'], label: 'python -c "print(2+2)" — run a real program', explain: 'this runs a real program: `python` executes the code, and `-c` means "run this command". This one just prints 2+2.' },
  },
  static: {
    peek: { cmd: 'cat', args: ['index.html'], label: 'cat index.html — the page your browser reads', explain: 'to see what\'s inside index.html we use the command `cat` — it stands for "concatenate" and it just prints a file\'s contents on screen.' },
    run: null,
  },
};

// Danger patterns checked against the raw typed line BEFORE anything runs. Word-ish
// patterns use \b so `rm` refuses "rm -rf" but not "term". Any match = refused.
const DANGER = [
  /\brm\b/, /\brmdir\b/, /\bsudo\b/, /\bmkfs\b/, /\bdd\b/, /\bshutdown\b/, /\breboot\b/,
  /:\(\{/, /[>]/, /;/, /\|/, /\$\(/, /`/, /\bchmod\b/, /\bchown\b/, /\bwget\b/, /\bcurl\b/,
];
export const dangerous = (line) => DANGER.some((re) => re.test(line));

// The appwalk-chosen "try it" command for a stack/step. The tour tags each step
// ('run' → show a real program executing, 'peek' → read the app's own config), and
// this follows the tag; a step that opens code but has no tag also gets the run demo.
// A step with neither a tag nor an open file gets nothing (no dead-end t advertised).
// Null when there's nothing safe to run for the detected stack.
export function suggest(stack, tourStep) {
  const s = ALLOWLIST[stack?.type];
  if (!s) return null;
  if (tourStep?.tags?.includes('run') && s.run) return s.run;
  if (tourStep?.tags?.includes('peek') && s.peek) return s.peek;
  const inCode = tourStep?.files?.[0] && /\.(js|py)$/.test(tourStep.files[0]);
  if (inCode && s.run) return s.run;
  if (tourStep?.tags?.length || tourStep?.files?.length) return s.peek || s.run || null;
  return null;
}

// On entry nothing runs yet: the suggested command is pre-filled into the editable
// input line (buf). Enter in step() actually executes it.
export const init = (params = {}) => {
  const { cmd, args, label, back, tourStep } = params;
  const buf = cmd ? [cmd, ...(args || [])].join(' ') : '';
  return { back: back || 'tour', tourStep, cmd, args, label, buf, out: '', err: '', code: 0, refused: false, ran: false };
};

export const hints = 'type a command · ENTER runs it · q = back to the tour';

// A compact reminder of the tour step the beginner came from, shown above the try box.
// Shows the step's title + body and (when the suggested command has one) the plain-words
// explain line — but not the interactive hint rows, since we're already here.
function tourContext(state, data) {
  const t = data?.tour?.[state.tourStep];
  if (!t) return '';
  const total = data.tour?.length ?? 0;
  const w = boxWidth('full') - 10;
  const s = suggest(data?.stack, t);
  const rows = [
    `  ${g('▶')}  ${g(t.title)}`,
    '',
    ...wrapParas(sanitize(t.body || ''), w).map((l) => `  ${l}`).slice(0, 12),
    ...(s?.explain ? ['', ...wrap(s.explain, w).map((l) => `  ${dim(l)}`).slice(0, 3)] : []),
  ];
  return box(`Guided tour · step ${(state.tourStep ?? 0) + 1} of ${total}`, rows, { width: 'full' });
}

export function render(state, data) {
  const rows = [
    `  ${g('▶')} try it — ${state.label || 'type a command below'}`,
    '',
    `  ${g('$')} ${sanitize(state.buf)}_`,
    ...(state.refused
      ? [
          '',
          `  ${dim('that command could do serious damage to your machine,')}`,
          `  ${dim('so I\'m not running it — try something like `cat package.json`.')}`,
        ]
      : state.ran
        ? [
            '',
            ...(state.out ? sanitize(state.out).split('\n').filter((l, i, a) => !(l === '' && i === a.length - 1)).map((l) => `  ${l}`) : []),
            ...(state.err ? [`  ${dim(sanitize(state.err))}`] : []),
            ...(state.code ? [`  ${dim(`(exit ${state.code})`)}`] : []),
          ]
        : ['', `  ${dim('press Enter to run the command above — or edit it first.')}`]),
    ...(state.ran && !state.refused
      ? ['', '  That ran on your machine just now —', '  that is what running code feels like.']
      : []),
    '',
    '  type your command · ENTER runs it · q = back to the tour',
  ];
  const ctx = tourContext(state, data);
  return (ctx ? ctx + '\n' : '') + box('Try it', rows, { width: 'full' });
}

// Async: Enter actually executes the typed command (after the danger check). The shell
// awaits cur.step(), which is a no-op for every other (sync) screen.
export async function step(state, key, data) {
  if (key === 'enter') {
    const line = state.buf.trim();
    if (!line) return state;                         // nothing typed — stay put
    const parts = line.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    if (dangerous(line)) {
      return { ...state, refused: true, out: '', err: '', code: 0, ran: true, cmd, args, label: line };
    }
    let out = '', err = '', code = 0;
    try {
      const res = await exec(cmd, args, { cwd: data?.root || process.cwd(), timeout: 10000, maxBuffer: 1 << 20 });
      out = res.stdout || '';
      err = res.stderr || '';
    } catch (e) {
      out = e.stdout || '';
      err = e.stderr || String(e.message || e);
      code = typeof e.code === 'number' ? e.code : 1;
    }
    return { ...state, out, err, code, refused: false, ran: true, cmd, args, label: line };
  }
  // Going back returns to the tour step this box came from (not step 0) so the
  // beginner lands exactly where they pressed t. `q` is only a back key when the
  // user isn't mid-command: while typing, `q` is just a letter (it accumulates in
  // the buffer below). It only quits on an EMPTY buffer or right after a run.
  // esc always cancels — it can never be a character in a command.
  if (key === 'esc') {
    return state.tourStep != null
      ? { to: state.back || 'tour', params: { resume: state.tourStep } }
      : { to: state.back || 'tour' };
  }
  if (key === 'q' && (state.buf.trim() === '' || state.ran)) {
    return state.tourStep != null
      ? { to: state.back || 'tour', params: { resume: state.tourStep } }
      : { to: state.back || 'tour' };
  }
  if (key === '\x7f' || key === 'backspace') return { ...state, buf: state.buf.slice(0, -1) };
  if (/^[ -~]$/.test(key)) return { ...state, buf: state.buf + key };
  return state;
}
