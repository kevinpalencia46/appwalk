// src/tui/app.js — the shell. Screens are registered here as they land.
import { mkLoop, bar } from './kit.js';
import { buildMap } from '../tree.js';
import { detectStack, buildTour } from '../walkthrough.js';
import * as home from './home.js';
import * as tour from './tour.js';

export const SCREENS = { home, tour };

export async function shell(root) {
  const map = await buildMap(root);
  const stack = detectStack(map);
  const data = { root, map, stack, tour: await buildTour(map, stack) };
  let screen = { name: 'home', state: home.init() };
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
        const target = SCREENS[next.to];
        if (!target) return true;              // screen not built yet — stay put
        screen = { name: next.to, state: next.params ? { ...target.init(), ...next.params } : target.init() };
      } else if (next) {
        screen = { name: screen.name, state: next };
      }
      paint();
      return true;
    },
  });
}
