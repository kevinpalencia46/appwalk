// src/tui.js
import { readFileSafe, humanSize } from './util.js';

export function renderTree(map, cursor, width = 80) {
  const lines = [];
  lines.push(`appwalk tree — ${map.root}`);
  lines.push('↑↓ move · Enter open · q quit'.padEnd(width, ' '));
  for (let i = 0; i < map.flat.length; i++) {
    const n = map.flat[i];
    const mark = n.entry ? '▶' : ' ';
    const meta = `${n.lang} · ${humanSize(n.size)}`.padStart(18);
    const line = `${mark} ${n.name.padEnd(24)}${meta}`.slice(0, width);
    lines.push(i === cursor ? `\x1b[7m${line}\x1b[0m` : line);
  }
  const hasEnv = map.flat.some((n) => n.name === '.env');
  lines.push(hasEnv ? '   .env detected — shown as location only (values never printed)'.slice(0, width) : '');
  return lines.join('\n');
}

// Pure view-state transition for the `appwalk tree` browser. The state is:
//   { mode: 'map'|'detail', detailNode, cursor, flat }
// (flat is map.flat, needed to clamp the cursor and resolve the detail node).
// Returns a fresh state — never mutates the input. `quit` while in map mode
// returns a `{ done: true }` marker so the caller can tear down.
export function step(state, key) {
  const { mode, cursor, detailNode, flat } = state;
  if (mode === 'detail') {
    // Enter and q both close the detail pane back to the map.
    if (key === 'enter' || key === 'quit') return { mode: 'map', cursor, detailNode: null, flat };
    return state;
  }
  switch (key) {
    case 'up': return { ...state, cursor: Math.max(0, cursor - 1) };
    case 'down': return { ...state, cursor: Math.min(flat.length - 1, cursor + 1) };
    case 'enter': {
      const node = flat[cursor];
      if (!node) return state;
      return { ...state, mode: 'detail', detailNode: node };
    }
    case 'quit': return { done: true };
    default: return state;
  }
}

// Decode the leading key from the input buffer. Returns { token, consumed }
// for a recognised key, { token: null, consumed: 1 } for an unknown char, or
// null when the buffer starts an escape sequence but is incomplete — the
// caller must wait for more data rather than consuming the lone `\x1b`.
function decodeKey(buf) {
  const ch = buf[0];
  if (ch === '\x1b') {
    if (buf.length < 3) return null;
    if (buf[1] === '[' && buf[2] === 'A') return { token: 'up', consumed: 3 };
    if (buf[1] === '[' && buf[2] === 'B') return { token: 'down', consumed: 3 };
    return { token: null, consumed: 1 };
  }
  if (ch === '\r') {
    // Consume the '\n' half of a '\r\n' pair so Enter doesn't fire twice.
    return { token: 'enter', consumed: buf[1] === '\n' ? 2 : 1 };
  }
  if (ch === '\n') return { token: 'enter', consumed: 1 };
  if (ch === 'q') return { token: 'quit', consumed: 1 };
  return { token: null, consumed: 1 };
}

export async function runTree(map, io = { stdin: process.stdin, stdout: process.stdout }) {
  let state = { mode: 'map', detailNode: null, cursor: 0, flat: map.flat };
  const detail = async (node) => {
    const text = (await readFileSafe(node.path) || '').slice(0, 4000);
    io.stdout.write('\x1b[2J\x1b[H' + `── ${node.path} ──\n\n${text}\n\n[Enter back · q quit]\n`);
  };
  const draw = async (s) => {
    if (s.mode === 'detail') await detail(s.detailNode);
    else io.stdout.write('\x1b[2J\x1b[H' + renderTree(map, s.cursor));
  };
  draw(state);
  const stdin = io.stdin;
  const wasRaw = stdin.isRaw;
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let buf = '';
  return new Promise((resolve) => {
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      stdin.removeListener('data', onData);
      if (stdin.setRawMode && wasRaw === false) stdin.setRawMode(false);
      stdin.pause();
      try { io.stdout.write('\x1b[2J\x1b[H'); } catch { /* never block teardown */ }
      if (err) console.error(err);
      resolve();
    };
    const onData = async (chunk) => {
      try {
        buf += chunk;
        let changed = false;
        while (buf.length) {
          const key = decodeKey(buf);
          if (!key) break;                       // incomplete escape: wait for more
          buf = buf.slice(key.consumed);
          if (!key.token) continue;              // unknown char: skip
          const next = step(state, key.token);
          if (next.done) return finish();
          changed = changed || next.mode !== state.mode || next.detailNode !== state.detailNode || next.cursor !== state.cursor;
          state = next;
        }
        if (changed) await draw(state);
      } catch (err) {
        finish(err);
      }
    };
    stdin.on('data', onData);
  });
}
