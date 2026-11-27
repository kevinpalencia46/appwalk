import { loadEnvFile, settings } from './env.js';
import { Core } from './core.js';
import { createServer } from './server.js';
import { log } from './log.js';

loadEnvFile();
const s = settings();
const core = new Core(s);
core.start();
const server = createServer(core);
server.listen(s.port, s.host, () => {
  log('info', `Ren 2 listening on http://${s.host}:${s.port} (adapters ${s.adapterMode}, telegram ${core.telegram.configured() ? 'on' : 'not configured'}, owner token ${s.ownerToken ? 'set' : 'NOT SET'})`);
  const resumed = core.tasks.runnable(100, []).filter((t) => t.state !== 'queued');
  if (resumed.length) log('info', `resuming ${resumed.length} in-flight task(s) from their last completed step`, resumed.map((t) => t.id));
});

let stopping = false;
async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  log('info', `${sig}: shutting down`);
  server.close();
  await core.stop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log('error', 'unhandled rejection', String((e as any)?.stack || e)));
