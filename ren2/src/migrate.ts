import { loadEnvFile, settings, ensureDirs } from './env.js';
import { openDb } from './db.js';

loadEnvFile();
const s = settings();
ensureDirs(s);
const db = openDb(s.dbPath);
const v = (db.prepare('SELECT v FROM schema_version').get() as { v: number }).v;
db.close();
console.log(`database ${s.dbPath} at schema v${v}`);
