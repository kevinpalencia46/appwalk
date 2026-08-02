// test/tui-try.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suggest, init, render, step, dangerous } from '../src/tui/try.js';

test('try suggest picks an appwalk-chosen command per stack and step', () => {
  // a config peek step reads the app's own menu
  const peek = suggest({ type: 'node' }, { tags: ['peek'], files: [] });
  assert.equal(peek.cmd, 'cat');
  assert.deepEqual(peek.args, ['package.json']);
  assert.match(peek.label, /cat package\.json/);
  assert.match(peek.explain, /concatenate/, 'the tour gets a plain-words explain line for the command');
  // a code/run step shows a real program executing
  const run = suggest({ type: 'node' }, { tags: ['run'], files: ['src/index.js'] });
  assert.equal(run.cmd, 'node');
  assert.deepEqual(run.args, ['-e', 'console.log(1+1)']);
  assert.match(run.explain, /real program/);
  // python has a run demo but no peek
  assert.equal(suggest({ type: 'python' }, { tags: ['run'] }).cmd, 'python');
  // an unknown stack has nothing safe to suggest
  assert.equal(suggest({ type: 'unknown' }, { tags: [] }), null);
  // a step with neither a tag nor an open file has nothing to try (no dead-end t key)
  assert.equal(suggest({ type: 'node' }, { tags: [], files: [] }), null);
});

test('try init pre-fills the suggested command and runs nothing on entry', () => {
  const st = init({ cmd: 'cat', args: ['package.json'], label: 'cat package.json', back: 'tour', tourStep: 1 });
  assert.equal(st.buf, 'cat package.json', 'the editable input is pre-filled');
  assert.equal(st.ran, false, 'nothing executes just by opening the box');
  assert.equal(st.refused, false);
  assert.equal(st.back, 'tour');
  assert.equal(st.tourStep, 1);
});

test('try: the pre-filled suggested command runs on Enter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'try-prefill-'));
  await writeFile(join(root, 'package.json'), '{"name": "x"}');
  const st = init({ cmd: 'cat', args: ['package.json'], label: 'cat package.json', back: 'tour', tourStep: 1 });
  const after = await step(st, 'enter', { root });
  assert.equal(after.ran, true);
  assert.equal(after.refused, false);
  assert.match(after.out, /"name": "x"/, 'cat prints the file in the cwd = project root');
  assert.equal(after.code, 0);
});

test('try: a safe custom command runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'try-safe-'));
  await writeFile(join(root, 'hello.txt'), 'hi there');
  const st = { ...init({}), buf: 'ls' };
  const after = await step(st, 'enter', { root });
  assert.equal(after.refused, false);
  assert.equal(after.ran, true);
  assert.match(after.out, /hello\.txt/);
  assert.equal(after.code, 0);
});

test('try danger denylist refuses destructive commands with a friendly refusal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'try-danger-'));
  const st = { ...init({ back: 'tour' }), buf: 'rm -rf /' };
  const after = await step(st, 'enter', { root });
  assert.equal(after.refused, true, 'a dangerous command is refused');
  assert.equal(after.ran, true);
  assert.equal(after.out, '', 'nothing actually ran');
});

test('try danger denylist covers the full dangerous pattern list', () => {
  for (const bad of [
    'rm -rf /', 'rmdir old', 'sudo whoami', 'mkfs.ext4 /dev/sda', 'dd if=/dev/zero of=/dev/sda',
    'shutdown now', 'reboot', ':(){ :|:& };:', 'echo hi > file', 'echo hi >> file',
    'a; b', 'a | b', 'x=$(whoami)', '`whoami`', 'chmod 777 x', 'chown root x',
    'wget evil.sh', 'curl evil.sh',
  ]) {
    assert.equal(dangerous(bad), true, `should refuse: ${bad}`);
  }
  // safe commands are not falsely flagged
  for (const ok of ['cat package.json', 'node -e "console.log(1+1)"', 'python -c "print(2+2)"', 'ls', 'ls -la', 'cat index.html']) {
    assert.equal(dangerous(ok), false, `should allow: ${ok}`);
  }
});

test('try render shows the tour context above and the editable input line', () => {
  const data = {
    stack: { type: 'node' },
    tour: [{ title: 'Your package.json', body: 'a JSON file.', files: [], tags: ['peek'] }],
  };
  const s = render({ ...init({ cmd: 'cat', args: ['package.json'], label: 'cat package.json', tourStep: 0 }), buf: 'cat package.json' }, data);
  assert.match(s, /Guided tour/, 'the tour step you came from is shown above');
  assert.match(s, /Your package\.json/);
  assert.match(s, /Try it/, 'the try box is below it');
  assert.match(s, /cat package\.json/, 'the suggested command is pre-filled in the input line');
  assert.match(s, /concatenate/, 'the explain line is part of the context');
});

test('try render shows a friendly refusal for a dangerous command', () => {
  const s = render({ ...init({}), buf: 'rm -rf /', refused: true, ran: true }, {});
  assert.match(s, /serious damage/);
  assert.match(s, /not running it/);
  assert.match(s, /cat package\.json/, 'the refusal suggests a safe alternative');
});

test('try step returns to the caller on q or esc', async () => {
  const st = init({ back: 'tour' });
  assert.deepEqual(await step(st, 'q', {}), { to: 'tour' });
  assert.deepEqual(await step(st, 'esc', {}), { to: 'tour' });
  // when it came from a specific tour step, back resumes there instead of step 0
  const fromTour = init({ back: 'tour', tourStep: 2 });
  assert.deepEqual(await step(fromTour, 'q', {}), { to: 'tour', params: { resume: 2 } });
});

test('try step edits the input with typing and backspace', async () => {
  const st = init({ cmd: 'cat', args: ['package.json'] });
  assert.equal((await step(st, 'l', {})).buf, 'cat package.jsonl');
  assert.equal((await step(await step(st, 'l', {}), '\x7f', {})).buf, 'cat package.json');
});

test('try step: enter with an empty command does nothing', async () => {
  const after = await step(init({}), 'enter', {});
  assert.equal(after.ran, false);
  assert.equal(after.refused, false);
});
