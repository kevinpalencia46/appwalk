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

export const SCREENS = { home, tour, viewer, tree, audit, glossary: glossaryScreen };

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
    process.stdout.write('\x1b[2J\x1b[H' + cur.render(screen.state, data) + '\n' + bar(screen.name, cur.hints));
  };
  paint(); // initial frame before entering the loop
  await mkLoop({
    stdin: process.stdin,
    stdout: process.stdout,
    onKey: async (key) => {
      const cur = SCREENS[screen.name];
      const next = cur.step(screen.state, key, data);
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
        screen = { name: targetName, state: { ...target.init(), ...params } };
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
