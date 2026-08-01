// src/tui/app.js — the shell. Screens are registered here as they land.
import { mkLoop, bar } from './kit.js';
import { buildMap } from '../tree.js';
import { detectStack, buildTour } from '../walkthrough.js';
import { scanSecrets } from '../audit/secrets.js';
import { scanDuplicates } from '../audit/duplicates.js';
import { scanClutter } from '../audit/clutter.js';
import { scanDeps } from '../audit/deps.js';
import { scanGit } from '../audit/githygiene.js';
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

const allFindings = async (root, m) => (await Promise.all([
  scanSecrets(m), scanDuplicates(m), scanClutter(m), scanDeps(m), scanGit(root, m),
])).flat();

export async function shell(root, { screen: start = 'home', map: preMap } = {}) {
  const map = preMap ?? await buildMap(root);
  const stack = detectStack(map);
  const data = {
    root,
    map,
    stack,
    tour: await buildTour(map, stack),
    tree: tree.buildFolderTree(map.flat),
    findings: await allFindings(root, map),
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
    onKey: (key) => {
      const cur = SCREENS[screen.name];
      const next = cur.step(screen.state, key, data);
      if (next?.done) return false;
      if (next?.to) {
        const route = ROUTES[next.to];
        const targetName = route ? route.screen : next.to;
        const target = SCREENS[targetName];
        if (!target) return true;              // screen not built yet — stay put
        const params = { ...(route?.params || {}), ...(next.params || {}) };
        screen = { name: targetName, state: { ...target.init(), ...params } };
      } else if (next) {
        screen = { name: screen.name, state: next };
      }
      paint();
      return true;
    },
  });
}
