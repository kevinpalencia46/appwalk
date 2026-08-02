// test/tui-try.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, init, render, step } from '../src/tui/try.js';

test('try suggest picks an appwalk-chosen command per stack and step', () => {
  // a config peek step reads the app's own menu
  assert.deepEqual(suggest({ type: 'node' }, { tags: ['peek'], files: [] }), {
    cmd: 'cat', args: ['package.json'], label: 'cat package.json — read your app\'s "menu"',
  });
  // a code/run step shows a real program executing
  assert.deepEqual(suggest({ type: 'node' }, { tags: ['run'], files: ['src/index.js'] }), {
    cmd: 'node', args: ['-e', 'console.log(1+1)'], label: 'node -e "console.log(1+1)" — run a real program',
  });
  // python has a run demo but no peek
  assert.deepEqual(suggest({ type: 'python' }, { tags: ['run'] }), {
    cmd: 'python', args: ['-c', 'print(2+2)'], label: 'python -c "print(2+2)" — run a real program',
  });
  // an unknown stack has nothing safe to suggest
  assert.equal(suggest({ type: 'unknown' }, { tags: [] }), null);
});

test('try init refuses a command outside the appwalk allowlist (never runs it)', async () => {
  const st = await init({ cmd: 'sh', args: ['-c', 'echo pwned'], back: 'tour' });
  assert.equal(st.out, '', 'no output from a non-allowlisted command');
  assert.equal(st.err, '', 'no stderr from a non-allowlisted command');
  assert.equal(st.code, 0);
  assert.equal(st.back, 'tour');
});

test('try init runs an allowlisted command and captures its output', async () => {
  // the exact appwalk-chosen demo: node -e "console.log(1+1)" → 2
  const st = await init({ cmd: 'node', args: ['-e', 'console.log(1+1)'], back: 'tour' });
  assert.match(st.out, /2/);
  assert.equal(st.err, '');
});

test('try render shows the command and its (injected) output in a framed box', () => {
  const s = render({ cmd: 'node', args: ['-e', 'console.log(1+1)'], label: 'node demo', out: '2\n', err: '', code: 0, back: 'tour' });
  assert.match(s, /Try it/);
  assert.match(s, /node -e console\.log\(1\+1\)/, 'shows the command being run');
  assert.match(s, /2/, 'shows the command output');
  assert.match(s, /Enter to go back/);
});

test('try render surfaces stderr and a nonzero exit code when present', () => {
  const s = render({ cmd: 'node', args: ['-e', 'bogus('], label: 'node demo', out: '', err: 'bogus( is not defined', code: 1, back: 'tour' });
  assert.match(s, /bogus/);
  assert.match(s, /exit 1/);
});

test('try step returns to the caller on Enter or q', () => {
  const st = { back: 'tour' };
  assert.deepEqual(step(st, 'enter'), { to: 'tour' });
  assert.deepEqual(step(st, 'q'), { to: 'tour' });
});
