#!/usr/bin/env node
import { join } from 'node:path';
const root = process.cwd();
const mode = process.argv[2] || 'walk';
console.log(`appwalk: ${mode} (root ${root})`);
