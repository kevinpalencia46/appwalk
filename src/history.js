// src/history.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export async function fileHistory(root, relPath) {
  try {
    const { stdout } = await exec('git', ['log', '--follow', '--format=%h|%ad|%s', '--date=short', '--', relPath], { cwd: root, timeout: 8000 });
    const lines = stdout.split('\n').filter(Boolean);
    if (!lines.length) return null;
    const first = lines[lines.length - 1];
    const last = lines[0];
    return {
      commits: lines.length,
      firstDate: first.split('|')[1],
      lastDate: last.split('|')[1],
      lastMessage: last.split('|')[2] || '',
    };
  } catch { return null; }
}
