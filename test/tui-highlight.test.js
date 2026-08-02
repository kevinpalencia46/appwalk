// test/tui-highlight.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight } from '../src/tui/highlight.js';

test('highlight colors keywords phosphor, strings dim green, comments dim', () => {
  const out = highlight('const x = "hi"; // note', 'js');
  assert.match(out, /\x1b\[38;2;51;255;102mconst\x1b\[0m/);      // keyword phosphor green
  assert.match(out, /\x1b\[38;2;31;153;64m"hi"\x1b\[0m/);        // string dim green
  assert.match(out, /\x1b\[2m\/\/ note\x1b\[0m/);                // comment dim
});
test('highlight passes unknown languages through unchanged', () => {
  const s = 'anything goes';
  assert.equal(highlight(s, 'txt'), s);
});

test('highlight neutralizes embedded terminal escape sequences', () => {
  const evil = 'console.log("x");\x1b[2J\x1b[?25l';
  const out = highlight(evil, 'js');
  assert.ok(!out.includes('\x1b[2J'), 'clear-screen escape leaked through');
  assert.ok(!out.includes('\x1b[?25l'), 'cursor-hide escape leaked through');
  // our OWN wrapper codes (color open/close) are the only escapes present
  const codes = out.match(/\x1b\[[0-9;]*m/g) || [];
  assert.ok(codes.every((c) => ['\x1b[38;2;51;255;102m', '\x1b[38;2;31;153;64m', '\x1b[2m', '\x1b[0m'].includes(c)));
  assert.equal((out.match(/\x1b\[/g) || []).length, codes.length);   // every escape is a color code
});
test('highlight sanitizes control chars even on the passthrough path', () => {
  const out = highlight('a\x1b[2Jb', 'txt');   // unknown lang → passthrough
  assert.ok(!out.includes('\x1b[2J'));
});
