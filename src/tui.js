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

export async function runTree(map, io = { stdin: process.stdin, stdout: process.stdout }) {
  let cursor = 0;
  const detail = async (node) => {
    const text = (await readFileSafe(node.path) || '').slice(0, 4000);
    io.stdout.write('\x1b[2J\x1b[H' + `── ${node.path} ──\n\n${text}\n\n[Enter back · q quit]\n`);
  };
  const draw = () => io.stdout.write('\x1b[2J\x1b[H' + renderTree(map, cursor));
  draw();
  const stdin = io.stdin;
  const wasRaw = stdin.isRaw;
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let buf = '';
  return new Promise((resolve) => {
    const onData = async (chunk) => {
      buf += chunk;
      while (buf.length) {
        const ch = buf[0];
        if (ch === '\x1b') {
          if (buf[1] === '[' && (buf[2] === 'A' || buf[2] === 'B')) {
            if (buf[2] === 'A') cursor = Math.max(0, cursor - 1);
            else cursor = Math.min(map.flat.length - 1, cursor + 1);
            buf = buf.slice(3); draw();
          } else buf = buf.slice(1);
          continue;
        }
        buf = buf.slice(1);
        if (ch === 'q') return finish();
        if (ch === '\r' || ch === '\n') {
          const node = map.flat[cursor];
          if (node) await detail(node);
          draw();
        }
      }
    };
    const finish = () => {
      stdin.removeListener('data', onData);
      if (stdin.setRawMode && wasRaw === false) stdin.setRawMode(false);
      stdin.pause();
      io.stdout.write('\x1b[2J\x1b[H');
      resolve();
    };
    stdin.on('data', onData);
  });
}
