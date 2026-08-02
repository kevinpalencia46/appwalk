// src/monitor.js
import { spawn } from 'node:child_process';

export function isCrash(line) {
  return /TypeError:|ReferenceError:|Error:|EADDRINUSE|ECONNREFUSED|UnhandledPromiseRejection|panic:|Traceback/.test(line);
}

export function runCommand(stack) {
  if (stack.type === 'node') return { cmd: 'npm', args: ['run', 'dev'] };
  if (stack.type === 'python') return { cmd: 'python', args: ['main.py'] };
  if (stack.type === 'static') return { cmd: 'python', args: ['-m', 'http.server', '8000'] };
  return null;
}

export function monitor(root, stack, { explain } = {}) {
  const run = runCommand(stack);
  if (!run) { console.log('monitor: no run command known for this project. Try `appwalk walk` first. (FAQ: monitor)'); return Promise.resolve(); }
  console.log(`monitor: running \`${run.cmd} ${run.args.join(' ')}\` (Ctrl-C to stop)`);
  return new Promise((resolve) => {
    const child = spawn(run.cmd, run.args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', (e) => { console.log('monitor: failed to start: ' + e.message + ' (FAQ: monitor)'); resolve(); });
    const onLine = (line) => {
      process.stdout.write(line + '\n');
      if (isCrash(line)) {
        console.log('⚠ possible error detected.');
        if (explain) explain(`A running app printed this error. Explain it simply and what to check:\n\n${line}`).then((r) => console.log('\n' + r.text)).catch(() => {});
      }
    };
    let buf = '';
    const feed = (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) onLine(line); }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('exit', (code) => { console.log(`monitor: app exited (code ${code})`); resolve(); });
    process.on('SIGINT', () => { try { child.kill('SIGTERM'); } catch {} setTimeout(resolve, 300); });
  });
}
