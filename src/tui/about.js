// src/tui/about.js
// Explain-on-open — the right-hand "About this file" panel shown in the viewer.
// Pure: takes a tree node and returns display lines teaching what kind of file it
// is, why the byte count matters, and (for package.json specifically) what `scripts`
// and `dependencies` are. Voice matches the glossary: what it is / why it matters to
// you / when you'd use it. Values are never read from .env — nodes can't be .env
// (the viewer guards that before this panel is ever reached).
import { humanSize } from '../util.js';
import { wrap } from './kit.js';

// Per-language "what it is / why it matters / when you'd use it" one-liners.
const KIND = {
  json: [
    'a settings file — the ID card for your app',
    'tools read it to know how your app runs and what it can do',
    'when you want to see what your app depends on or how to run it',
  ],
  js: [
    'JavaScript — the code that makes your app behave',
    'it is the "how" — the logic behind every button, page and data load',
    'when you want to know why your app does what it does',
  ],
  jsx: [
    'JSX — JavaScript that also writes your interface',
    'it mixes logic and layout in one place',
    'when you work on what the user sees',
  ],
  mjs: [
    'JavaScript (module) — the code that makes your app behave',
    'modules keep code in clean files that load on demand',
    'when an app is split into importable pieces',
  ],
  cjs: [
    'JavaScript (CommonJS) — the code that makes your app behave',
    'an older way Node apps import code',
    'when you see require() instead of import',
  ],
  ts: [
    'TypeScript — JavaScript with types',
    'types catch whole classes of bugs before you run the app',
    'when your codebase gets big enough that surprises are common',
  ],
  tsx: [
    'TypeScript + JSX — typed code that builds the interface',
    'types plus the UI live in one file',
    'when a React-style app uses TypeScript',
  ],
  py: [
    'Python — another language apps are written in',
    'it reads a lot like plain English, which is why it is so common',
    'when your backend or scripts are written in Python',
  ],
  html: [
    'the page structure your browser reads',
    'it is the skeleton every page is built on',
    'when you want to see what a page contains',
  ],
  css: [
    'the styling — colors, fonts, layout',
    'it decides how your app looks, not what it does',
    'when you want to change colors, spacing or fonts',
  ],
  md: [
    'plain-text notes/readme',
    'docs and instructions live here, easy to read anywhere',
    'when you want to understand the project before touching code',
  ],
  sql: [
    'database queries and structure',
    'it shows how your data is stored and shaped',
    'when you wonder how user data is saved',
  ],
  sh: [
    'a shell script — commands your machine can run',
    'it automates tasks like setup, tests or deploys',
    'when you see setup scripts or CI running commands',
  ],
};

const FALLBACK = (lang) => [
  `${/^[aeiou]/i.test(lang) ? 'an' : 'a'} ${lang} file`,
  'a file your app reads or runs',
  'when you want to understand what this part does',
];

// "Why the byte count matters" — sized so a beginner knows big files are a signal.
const sizeTone = (n) => n >= 100 * 1024
  ? 'large — a lot is usually happening in one place'
  : n >= 1024
    ? 'a medium-size chunk of text, like a page of notes'
    : 'small, like a sticky note';

export function aboutFile(node, wrapWidth = 34) {
  const name = node?.name || 'this file';
  const lang = node?.lang || 'text';
  const [what, why, when] = KIND[lang] || FALLBACK(lang);
  const size = node?.size ?? 0;
  const lines = [
    `  ${name}`,
    '',
    '  what it is',
    ...wrap(what, wrapWidth).map((l) => `  ${l}`),
    '',
    '  why it matters to you',
    ...wrap(why, wrapWidth).map((l) => `  ${l}`),
    '',
    "  when you'd use it",
    ...wrap(when, wrapWidth).map((l) => `  ${l}`),
    '',
    `  size: ${humanSize(size)}`,
    ...wrap(`That's how much text is in the file — ${humanSize(size)} is ${sizeTone(size)}. Big files (100KB+) usually mean a lot is happening in one place.`, wrapWidth).map((l) => `  ${l}`),
  ];
  if (node?.name === 'package.json') {
    lines.push(
      '',
      '  scripts',
      ...wrap('Commands you can run, like npm run dev; each one is a shortcut for a longer command. You\'d add one when you find yourself typing the same command over and over.', wrapWidth).map((l) => `  ${l}`),
      '',
      '  dependencies',
      ...wrap('Libraries your app relies on — code other people wrote that you "install" into your project. Fewer is safer; each one is code you\'re trusting.', wrapWidth).map((l) => `  ${l}`),
    );
  }
  return lines;
}
