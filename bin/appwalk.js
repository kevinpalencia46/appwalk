#!/usr/bin/env node
import { buildMap } from '../src/tree.js';
import { runTree } from '../src/tui.js';

const root = process.cwd();
const mode = process.argv[2] || 'walk';
if (mode === 'tree') {
  const map = await buildMap(root);
  if (!map.flat.length) { console.log('appwalk: no files found (empty or fully ignored).'); process.exit(0); }
  await runTree(map);
} else {
  console.log(`appwalk: mode "${mode}" not built yet. Try: appwalk tree`);
}
