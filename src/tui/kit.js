// src/tui/kit.js
export const W = () => process.stdout.columns || 80;
export const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
export const g = (s) => c('32', s);
export const b = (s) => c('34', s);
export const y = (s) => c('33', s);
export const r = (s) => c('31', s);
export const dim = (s) => c('2', s);
export const inv = (s) => c('7', s);

export function box(title, lines, { width = W() } = {}) {
  const w = Math.min(Math.max(width, 30), 120);
  const inner = w - 4;
  const t0 = String(title);
  const t = t0.length > w - 6 ? t0.slice(0, w - 7) + '…' : t0;
  const top = `┌─ ${t} ${'─'.repeat(Math.max(0, w - t.length - 5))}┐`;
  const rows = lines.map((l) => `│ ${String(l).slice(0, inner).padEnd(inner)} │`);
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
  return new Promise((resolve) => {
    let finished = false;
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
    const onEnd = finish;
    const onData = (chunk) => {
      try {
        buf += chunk;
        while (buf.length) {
          // wait for a full escape sequence before decoding it
          if (buf[0] === '\x1b' && buf.length < 3) break;
          const d = decodeKey(buf);
          buf = buf.slice(d.used);
          if (d.token === null) continue;
          if (onKey(d.token) === false) return finish();
        }
      } catch (e) { finish(); }
    };
    stdin.on('data', onData);
    stdin.on('end', onEnd);
  });
}
