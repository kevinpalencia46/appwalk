// src/tui/mascot.js — the appwalk character: a duck holding a lantern.
// Rubber-duck debugging reversed: the duck explains *your* code to *you*.
//
// Four-frame walk cycle (contact / passing mirrored), 200ms per frame (5fps),
// with the lantern rocking ±1 column in counterpoint to the stride. The flame
// flickers on a SEPARATE 370ms interval so the two cycles drift apart — the
// periods (200ms and 370ms) never divide evenly, so the motion never locks
// into a repeating 2x stutter.
//
// The mascot is home-screen only. `animateMascot` rewrites ONLY the mascot rows
// (save cursor, jump to each row, restore) — it never repaints the screen — and
// hides the cursor for the duration, restoring it on cleanup and on SIGINT. When
// stdout is not a TTY (piped / CI / NO_COLOR) it emits one static frame and does
// not animate. On a slow SSH link the animation settles to a static pose after ~3s.
import { amber, dim, g } from './kit.js';

// 14 rows x exactly 40 columns, fixed width. `*` is the lantern flame (amber);
// every other glyph is the phosphor-green linework applied at render time.
const F1 = [
  '     .-~~~-.             .-~~~~-.       ',
  '    / o   o \\           /        \\      ',
  '    |   >    |          |  .---.  |     ',
  '    |   ~    |          | (  *  ) |     ',
  '     \\     /            |  \'---\'  |     ',
  '      \'-.-\' \\~~~~~~~~~~~|   | |   |     ',
  '      /   \\             |   | |   |     ',
  '     |     |            \'---\' \'---\'     ',
  '     |     |                            ',
  '     \'-----\'                            ',
  '      |   |                             ',
  '      |   |                             ',
  '     / \\ / \\                            ',
  '                                        ',
];
const F2 = [
  '     .-~~~-.            .-~~~~-.        ',
  '    / o   o \\          /        \\       ',
  '    |   >    |         |  .---.  |      ',
  '    |   ~    |         | (  *  ) |      ',
  '     \\     /           |  \'---\'  |      ',
  '      \'-.-\' \\~~~~~~~~~~|   | |   |      ',
  '      /   \\            |   | |   |      ',
  '     |     |           \'---\' \'---\'      ',
  '     |     |                            ',
  '     \'-----\'                            ',
  '      \\   /                             ',
  '       \\ /                              ',
  '       / \\                              ',
  '                                        ',
];
const F3 = [
  '     .-~~~-.             .-~~~~-.       ',
  '    / o   o \\           /        \\      ',
  '    |   >    |          |  .---.  |     ',
  '    |   ~    |          | (  *  ) |     ',
  '     \\     /            |  \'---\'  |     ',
  '      \'-.-\' \\~~~~~~~~~~~|   | |   |     ',
  '      /   \\             |   | |   |     ',
  '     |     |            \'---\' \'---\'     ',
  '     |     |                            ',
  '     \'-----\'                            ',
  '        |  |                            ',
  '        |  |                            ',
  '       / \\ / \\                          ',
  '                                        ',
];
const F4 = [
  '     .-~~~-.              .-~~~~-.      ',
  '    / o   o \\            /        \\     ',
  '    |   >    |           |  .---.  |    ',
  '    |   ~    |           | (  *  ) |    ',
  '     \\     /             |  \'---\'  |    ',
  '      \'-.-\' \\~~~~~~~~~~~~|   | |   |    ',
  '      /   \\              |   | |   |    ',
  '     |     |             \'---\' \'---\'    ',
  '     |     |                            ',
  '     \'-----\'                            ',
  '      /   \\                             ',
  '       / \\                              ',
  '       \\ /                              ',
  '                                        ',
];

// Raw walk-cycle frames: 14 rows x 40 cols, `*` marks the lantern flame.
export const MASCOT_FRAMES = [F1, F2, F3, F4];

export const MASCOT_ROWS = F1.length;
export const MASCOT_COLS = F1[0].length;

// Color one frame: phosphor-green linework, amber flame (dimmed on flicker-off).
export function renderMascot(i, flick = true) {
  const f = MASCOT_FRAMES[i % MASCOT_FRAMES.length];
  const flame = flick ? amber('*') : dim(amber('*'));
  return g(f.join('\n').replace('*', flame));
}

// The static pose (home pose, bright flame) — what the box shows before/without
// the animation overlay, and the one frame emitted on a non-TTY.
export const MASCOT_STATIC = renderMascot(0, true);

const FALLBACK = { row: 2, col: 6 };

// Animate the mascot in place. Rewrites only the mascot rows (never a full
// repaint): save cursor, jump to each row, write the frame, restore the cursor.
// Hides the cursor for the duration; restores it on cleanup, on SIGINT and on
// process exit. Stops on the first keypress and settles to a static pose after
// ~3s (SSH fallback). Returns a cleanup function.
export function animateMascot(stdout, at = FALLBACK) {
  if (!stdout || !stdout.isTTY) {
    stdout?.write(MASCOT_STATIC + '\n');
    return () => {};
  }
  const { row, col } = at;
  let fi = 0;
  let flick = true;
  let done = false;
  let walkTimer;
  let flickTimer;
  let settleTimer;

  const paint = () => {
    const lines = renderMascot(fi, flick).split('\n');
    for (let i = 0; i < MASCOT_ROWS; i++) {
      stdout.write(`\x1b[${row + i};${col}H${lines[i]}`);
    }
  };

  // "Stop on first keypress" only makes sense at a real keyboard — attach the
  // listener only when stdin is also an interactive TTY (a piped stdin, as under
  // CI or the test runner, must never be leaked into flowing mode).
  const input = process.stdin;
  const interactive = !!(input && input.isTTY && input.setRawMode);
  const onKey = () => cleanup();
  const onSigint = () => cleanup();
  const onExit = () => { if (!done) stdout.write('\x1b[u\x1b[?25h'); };

  const cleanup = () => {
    if (done) return;
    done = true;
    clearInterval(walkTimer);
    clearInterval(flickTimer);
    clearTimeout(settleTimer);
    if (interactive) input.removeListener('data', onKey);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('exit', onExit);
    stdout.write('\x1b[u\x1b[?25h');
  };

  stdout.write('\x1b[s\x1b[?25l');
  paint();
  walkTimer = setInterval(() => { fi = (fi + 1) % MASCOT_FRAMES.length; paint(); }, 200);
  flickTimer = setInterval(() => { flick = !flick; paint(); }, 370);
  // One-shot: on a slow SSH link the animation is janky, so after ~3s settle to
  // a static pose and stop — the screen stays readable and the cursor is restored.
  settleTimer = setTimeout(() => { fi = 0; flick = true; paint(); cleanup(); }, 3000);
  if (interactive) input.on('data', onKey);
  process.once('SIGINT', onSigint);
  process.on('exit', onExit);
  return cleanup;
}
