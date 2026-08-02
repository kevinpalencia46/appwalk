// src/tui/app.js — the shell. Screens are registered here as they land.
import { mkLoop, bar } from './kit.js';
import { buildMap } from '../tree.js';
import { detectStack, buildTour } from '../walkthrough.js';
import { allFindings } from '../audit/index.js';
import { inc as statsInc } from '../stats.js';
import * as home from './home.js';
import * as tour from './tour.js';
import * as viewer from './viewer.js';
import * as tree from './tree.js';
import * as audit from './audit.js';
import * as glossaryScreen from './glossary.js';
import * as tryScreen from './try.js';

export const SCREENS = { home, tour, viewer, tree, audit, glossary: glossaryScreen, try: tryScreen };

// Virtual home routes that land on a real screen with params.
const ROUTES = {
  ask: { screen: 'viewer', params: { mode: 'input' } },
};

export async function shell(root, { screen: start = 'home', map: preMap } = {}) {
  const map = preMap ?? await buildMap(root);
  const stack = detectStack(map);
  const data = {
    root,
    map,
    stack,
    tour: await buildTour(map, stack),
    tree: tree.buildFolderTree(map.flat),
    // findings deliberately NOT precomputed here: the audit scans read every file, so
    // eagerly awaiting them would stall the home menu and `appwalk tree`. They're
    // computed lazily the first time the audit screen is entered (see onKey below) and
    // memoized on `data` so the 5 scans run exactly once per shell session.
  };
  const name = SCREENS[start] ? start : 'home';
  let screen = { name, state: SCREENS[name].init() };
  const paint = () => {
    const cur = SCREENS[screen.name];
    const hints = typeof cur.hints === 'function' ? cur.hints(screen.state, data) : cur.hints;
    const body = cur.render(screen.state, data);
    const n = body.split('\n').length;
    const rows = process.stdout.rows || 24;
    // The box hugs its content (short screens are compact). Anchor its vertical
    // center ~1/3 down the screen so it isn't pinned to the top edge; clamp so it
    // never pushes past the hint bar's row. Content-heavy screens are already capped
    // at terminal height by box(), so a full box lands at row 1 and fills.
    const center = Math.max(1, Math.floor(rows / 3));
    const top = Math.max(1, Math.min(center - Math.floor(n / 2), rows - n - 1));
    process.stdout.write(
      '\x1b[2J\x1b[H' +
      `\x1b[${top};1H` + body +
      `\x1b[${rows};1H` + bar(screen.name, hints) +
      `\x1b[${Math.min(top + n, rows - 1)};1H`,
    );
  };
  paint(); // initial frame before entering the loop
  await mkLoop({
    stdin: process.stdin,
    stdout: process.stdout,
    onKey: async (key) => {
      // Global navigation: `h` returns to the home menu from anywhere (the beginner
      // friendly way out — every screen also keeps its own q/q-back behavior).
      if (key === 'h' && screen.name !== 'home') {
        screen = { name: 'home', state: SCREENS.home.init() };
        paint();
        return true;
      }
      // Audit detail's `c` copies the "ask your AI" prompt (best-effort clipboard).
      // I/O lives in the shell, so the audit screen's step stays pure.
      if (screen.name === 'audit' && key === 'c') {
        const f = audit.currentFinding(screen.state, data);
        if (f) await audit.copyPrompt(audit.askYourAI(f));
        paint();
        return true;
      }
      const cur = SCREENS[screen.name];
      // cur.step is awaited because the try screen's step is async (Enter actually
      // runs the typed command); every other screen's step is sync and awaits trivially.
      const next = await cur.step(screen.state, key, data);
      if (next?.done) return false;
      if (next?.to) {
        if (next.to === 'audit' && !data.findings) {
          data.findings = await allFindings(root, map);   // lazy, memoized on data
        }
        const route = ROUTES[next.to];
        const targetName = route ? route.screen : next.to;
        const target = SCREENS[targetName];
        if (!target) return true;              // screen not built yet — stay put
        const params = { ...(route?.params || {}), ...(next.params || {}) };
        // A screen init may be async; await it and hand it the route params.
        let base = target.init(params);
        if (base && typeof base.then === 'function') base = await base;
        screen = { name: targetName, state: { ...base, ...params } };
      } else if (next) {
        // Instrumentation (product brief §0): reaching the choose-your-model step in the
        // tour is a key funnel signal — measured locally, no telemetry home.
        if (screen.name === 'tour' && next.step !== screen.state.step && data.tour?.[next.step]?.title?.includes('Choosing your AI model')) {
          statsInc('reached_model_step');
        }
        screen = { name: screen.name, state: next };
      }
      paint();
      return true;
    },
  });
}
