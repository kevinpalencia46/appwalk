// src/tui/kit.js
export const W = () => process.stdout.columns || 80;
export const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
export const g = (s) => c('32', s);
export const b = (s) => c('34', s);
export const y = (s) => c('33', s);
export const r = (s) => c('31', s);
export const dim = (s) => c('2', s);
export const inv = (s) => c('7', s);

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

export function box(title, lines, { width = W() } = {}) {
  const w = Math.min(Math.max(width, 30), 120);
  const inner = w - 4;
  const t0 = String(title);
  const t = t0.length > w - 6 ? t0.slice(0, w - 7) + '…' : t0;
  const top = `┌─ ${t} ${'─'.repeat(Math.max(0, w - t.length - 5))}┐`;
  const rows = lines.map((l) => {
    let s = String(l);
    if (visLen(s) > inner) s = sliceVis(s, inner);
    return `│ ${s + ' '.repeat(Math.max(0, inner - visLen(s)))} │`;
  });
  return [top, ...rows, `└${'─'.repeat(w - 2)}┘`].join('\n');
}

export function bar(left, right) {
  const w = W();
  const l = String(left), r2 = String(right);
  const pad = Math.max(0, w - l.length - r2.length);
  return inv((l + ' '.repeat(pad) + r2).slice(0, w));
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
