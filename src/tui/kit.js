// src/tui/kit.js — shared TUI primitives + the phosphor palette.
//
// Monochrome phosphor (spec 2026-08-01-visual-identity):
//   phosphor green  #33FF66  primary text, emphasis, headers, mascot linework
//   dim green       #1F9940  borders, inactive, secondary
//   lantern amber   #FFB300  the lantern flame ONLY — nothing else
//   danger red      #FF4444  real secrets ONLY — nothing else
// Two semantic rules are enforced across every screen: amber never appears off
// the mascot's lantern, and red never appears off a real secret.
export const W = () => process.stdout.columns || 80;
export const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
export const g = (s) => c('38;2;51;255;102', s);   // phosphor green #33FF66
export const dg = (s) => c('38;2;31;153;64', s);   // dim green #1F9940
export const amber = (s) => c('38;2;255;179;0', s); // lantern amber #FFB300 — lantern only
export const r = (s) => c('38;2;255;68;68', s);    // danger red #FF4444 — secrets only
export const dim = (s) => c('2', s);
export const inv = (s) => c('7', s);

// Wrap a paragraph to `width` visible characters, keeping whole words intact. Shared by
// the tour body and the glossary definition pane so long prose never overflows a box.
export function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

// Resolve a requested box width: 'full' means the whole terminal minus a 2-col margin,
// capped at 78 so no content line ever exceeds ~74 visible columns — the old 140+ char
// rows were the biggest "not designed" tell. Anything else is clamped to [min, 78].
// The default minimum (44) is deliberately wide so a beginner can see a screen's
// contents at a glance.
export const boxWidth = (width = W(), min = 44) => {
  if (width === 'full') width = Math.max(2, W() - 2);
  return Math.min(Math.max(width, min), 78);
};

// Terminal-escape injection guard: repo content rendered into a raw-mode terminal is
// untrusted. Strip ESC (0x1b), C0 controls (0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f), DEL and
// the C1 controls (0x7f-0x9f) — every byte that a terminal would interpret — replacing
// them with U+FFFD so the text stays readable. Shared by every screen that renders
// untrusted text (tour bodies, audit findings, the highlighter).
export const sanitize = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '�');

// Visible length of a string: ANSI SGR runs (\x1b[<params>m) set color, they don't
// occupy columns, so counting them toward box width makes colored rows short.
export const visLen = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').length;

// Truncate to `max` VISIBLE characters, walking the string so we never split an ANSI
// sequence. If the cut leaves a color run open, close it with a reset so the row still
// renders as well-formed SGR and the trailing reset survives truncation.
export function sliceVis(s, max) {
  const str = String(s);
  let out = '';
  let vis = 0;
  let open = false;
  let i = 0;
  while (i < str.length && vis < max) {
    if (str[i] === '\x1b' && str[i + 1] === '[') {
      let j = i + 2;
      while (j < str.length && !((str[j] >= 'A' && str[j] <= 'Z') || (str[j] >= 'a' && str[j] <= 'z'))) j++;
      j = Math.min(str.length, j + 1);
      const code = str.slice(i, j);
      out += code;
      if (code.endsWith('m')) open = !(code === '\x1b[m' || code === '\x1b[0m');
      i = j;
      continue;
    }
    out += str[i];
    vis++;
    i++;
  }
  if (open) out += '\x1b[0m';
  return out;
}

// Stitch two box() frames side by side, padding the shorter so the frames line up.
// Shared by the glossary (term list + definition) and the viewer (file content +
// "About this file" panel). Each frame must already fit its own width.
export function sideBySide(left, right) {
  const l = String(left).split('\n');
  const r = String(right).split('\n');
  const n = Math.max(l.length, r.length);
  const lw = Math.max(...l.map((x) => visLen(x)));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = l[i] ?? ' '.repeat(lw);
    const b = r[i] ?? '';
    rows.push(a + ' '.repeat(Math.max(0, lw - visLen(a))) + '  ' + b);
  }
  return rows.join('\n');
}

// A framed panel. Width is clamped to [min, 78]. The box HUGS its content: exactly
// one blank row of padding inside the top and bottom borders, and never taller than
// the terminal minus the hint bar's row — short screens (tour step, home, audit
// summary) stay compact instead of drawing a ~40-row box around ~6 rows of text.
// Content-heavy screens (tree, viewer) pass `height: 'full'` to fill the space up to
// the same cap; a box that would overflow the terminal is truncated at the cap and
// the screen's own scrolling reaches the rest. The shell positions the finished box
// ~1/3 down the screen and pins the hint bar to the bottom row.
// Borders are dim green, the title phosphor green: the box is the screen's frame.
export function box(title, lines, { width = W(), min = 44, height } = {}) {
  const w = boxWidth(width, min);
  const inner = w - 4;
  const t0 = String(title);
  const t = t0.length > w - 6 ? t0.slice(0, w - 7) + '…' : t0;
  const row = (l) => {
    let s = String(l);
    if (visLen(s) > inner) s = sliceVis(s, inner);
    return dg('│ ') + s + ' '.repeat(Math.max(0, inner - visLen(s))) + dg(' │');
  };
  const blank = () => dg('│ ') + ' '.repeat(inner) + dg(' │');
  // Content rows allowed between the borders: the whole box must stay within
  // (terminal rows − 1) so the hint bar always owns the last row.
  const maxRows = Math.max(3, (process.stdout.rows || 24) - 3);
  let content = lines.map(row);
  if (height === 'full') {
    // Content-heavy screens fill the space (padded up, then capped at the terminal).
    while (content.length < maxRows) content.push(blank());
    content = content.slice(0, maxRows);
  } else {
    // Compact: content + one blank pad row inside the top and bottom borders.
    content = ['', ...content, ''];
    if (content.length > maxRows) content = content.slice(0, maxRows);
  }
  const top = dg('┌─ ') + g(t) + dg(' ' + '─'.repeat(Math.max(0, w - visLen(t) - 5)) + '┐');
  const bottom = dg('└' + '─'.repeat(w - 2) + '┘');
  return [top, ...content, bottom].join('\n');
}

export function bar(left, right) {
  const w = W();
  const l = String(left), r2 = String(right);
  const pad = Math.max(0, w - l.length - r2.length);
  const line = (l + ' '.repeat(pad) + r2).slice(0, w);
  // Quiet status bar: dim-green foreground on black, NO solid background — the
  // quietest thing on the screen. Only the one primary key (Enter) is bright
  // phosphor green, so the single next action is what catches the eye.
  const muted = '\x1b[38;2;31;153;64m';
  const bright = '\x1b[1;38;2;51;255;102m';
  return muted + line.replace(/\bEnter\b/i, (m) => `${bright}${m}\x1b[0m${muted}`) + '\x1b[0m';
}

export function decodeKey(buf) {
  if (buf[0] === '\x1b') {
    if (buf[1] === '[' && 'ABCD'.includes(buf[2])) {
      return { token: { A: 'up', B: 'down', C: 'right', D: 'left' }[buf[2]], used: 3 };
    }
    return { token: null, used: 1 };   // lone esc or unknown escape: consume one byte
  }
  if (buf[0] === '\r' || buf[0] === '\n') {
    return { token: 'enter', used: (buf[0] === '\r' && buf[1] === '\n') ? 2 : 1 };
  }
  return { token: buf[0], used: 1 };
}

export function mkLoop({ stdin, stdout, onKey }) {
  const wasRaw = stdin.isRaw;
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let buf = '';
  let chain = Promise.resolve();      // serializes async onKey handlers
  let finished = false;
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const finish = () => {
    if (finished) return;
    finished = true;
    stdin.removeListener('data', onData);
    stdin.removeListener('end', onEnd);
    if (stdin.setRawMode && wasRaw === false) stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\x1b[2J\x1b[H');
    resolve();
  };
  const onEnd = () => finish();
  const processBuf = async () => {
    while (buf.length && !finished) {
      // wait for a full escape sequence before decoding it
      if (buf[0] === '\x1b' && buf.length < 3) break;
      const d = decodeKey(buf);
      buf = buf.slice(d.used);
      if (d.token === null) continue;
      if (await onKey(d.token) === false) { finish(); return; }
    }
  };
  const onData = (chunk) => {
    if (finished) return;
    try {
      buf += chunk;
      chain = chain.then(processBuf).catch(() => finish());
    } catch (e) { finish(); }
  };
  stdin.on('data', onData);
  stdin.on('end', onEnd);
  return done;
}
