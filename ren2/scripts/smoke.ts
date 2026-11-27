// End-to-end smoke test against the real built server process.
//  1. boots Ren 2 on a temp data dir (cloud providers off unless SMOKE_MODELS=1)
//  2. M1 demo via a fake Telegram Bot API: "summarize what's in memory about Storefront"
//  3. restart-resume: kill -9 mid-task, restart, task finishes, step 1 ran once
//  4. kill switch via /stop and /resume
//  5. every dashboard page's main endpoint answers
// Usage: npm run smoke   (exit code 0 = pass)
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { ROOT } from '../src/env.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ren2-smoke-'));
const port = 8790 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${port}`;
let failures = 0;
const ok = (cond: unknown, label: string) => {
  console.log(`${cond ? '✔' : '✘'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fake Telegram Bot API
const tgCalls: { method: string; body: any }[] = [];
const tgUpdates: any[] = [];
const tg = http.createServer((req, res) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', async () => {
    const method = req.url!.split('/').pop()!;
    const body = s ? JSON.parse(s) : {};
    if (method === 'getUpdates') {
      const until = Date.now() + 1500;
      while (!tgUpdates.length && Date.now() < until) await sleep(50);
    } else tgCalls.push({ method, body });
    const result = method === 'getUpdates' ? tgUpdates.splice(0) : method === 'sendMessage' ? { message_id: tgCalls.length } : true;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  });
});
await new Promise<void>((r) => tg.listen(0, '127.0.0.1', () => r()));
const tgBase = `http://127.0.0.1:${(tg.address() as AddressInfo).port}`;
let uid = 1;
const say = (text: string) => tgUpdates.push({ update_id: uid++, message: { message_id: uid, chat: { id: 4242 }, text } });
const tgTexts = () => tgCalls.filter((c) => c.method === 'sendMessage').map((c) => String(c.body.text));

// Seed knowledge
const kdir = path.join(dir, 'knowledge');
fs.mkdirSync(path.join(kdir, 'storefront'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'knowledge', 'storefront', 'brief-facts.md'), path.join(kdir, 'storefront', 'brief-facts.md'));

const env = {
  ...process.env,
  REN2_PORT: String(port),
  REN2_HOST: '127.0.0.1',
  REN2_DATA_DIR: path.join(dir, 'data'),
  REN2_WORKSPACE: path.join(dir, 'workspace'),
  REN2_KNOWLEDGE_DIR: kdir,
  REN2_OWNER_TOKEN: '',
  TELEGRAM_BOT_TOKEN: 'SMOKE:token',
  TELEGRAM_CHAT_ID: '4242',
  TELEGRAM_API_BASE: tgBase,
  REN2_TICK_MS: '100',
  REN2_PROVIDERS_OFF: process.env.SMOKE_MODELS === '1' ? 'anthropic,deepseek,kimi' : 'anthropic,deepseek,kimi,ollama,claude_code',
  REN2_LOG: 'quiet',
};

let proc: ChildProcess | null = null;
async function start() {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'dist', 'src', 'main.js')], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error('server did not start');
}
const j = async (p: string, body?: any) => {
  const r = await fetch(base + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json() as Promise<any>;
};
async function until<T>(fn: () => Promise<T | undefined | false>, ms: number, label: string): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`timeout: ${label}`);
}

try {
  await start();
  ok(true, `server up on ${base}`);

  // ── M1 demo over Telegram ──
  say("summarize what's in memory about Storefront");
  const demoTask = await until(async () => (await j('/api/tasks')).find((t: any) => t.source === 'telegram' && t.state === 'done'), 120_000, 'telegram task done');
  ok(/1,000 visits|0 orders/i.test(demoTask.result), `M1 demo answered from memory (task #${demoTask.id})`);
  await until(async () => tgTexts().some((t) => /1,000 visits|0 orders/i.test(t)), 5000, 'answer on telegram');
  ok(true, 'answer delivered to Telegram');

  // ── restart resume (hard kill) ──
  const marker = path.join(dir, 'workspace', 'ran.txt');
  const t = await j('/api/tasks', { objective: 'smoke resume', plan: [
    { tool: 'shell', args: { cmd: `echo once >> ${marker}` } },
    { tool: 'shell', args: { cmd: 'sleep 3; echo slept' } },
    { tool: 'system', args: { action: 'echo', text: 'resumed after {{step.1}}' } },
  ] });
  await until(async () => (await j(`/api/tasks/${t.id}`)).steps[1].status === 'running', 10_000, 'step 2 running');
  proc!.kill('SIGKILL');
  await sleep(300);
  ok(true, 'killed process with SIGKILL mid-task');
  await start();
  const resumed = await until(async () => {
    const x = await j(`/api/tasks/${t.id}`);
    return x.state === 'done' ? x : undefined;
  }, 20_000, 'resumed task done');
  ok(/resumed after slept/.test(resumed.result), 'task resumed and finished after restart');
  ok(fs.readFileSync(marker, 'utf8').trim().split('\n').length === 1, 'completed step 1 was not re-run');

  // ── kill switch via Telegram ──
  say('/stop');
  await until(async () => (await j('/api/status')).halted, 5000, 'halted');
  ok(true, '/stop halted Ren 2');
  const held = await j('/api/tasks', { objective: 'held', plan: [{ tool: 'system', args: { action: 'echo', text: 'ran' } }] });
  await sleep(600);
  ok((await j(`/api/tasks/${held.id}`)).state === 'queued', 'nothing runs while halted');
  say('/resume');
  await until(async () => (await j(`/api/tasks/${held.id}`)).state === 'done', 10_000, 'held task ran');
  ok(true, '/resume restarted work');

  // ── pages' endpoints ──
  for (const p of ['/api/status', '/api/chat', '/api/tasks', '/api/decisions?status=open', '/api/agents', '/api/projects', '/api/memory', '/api/system', '/api/alerts', '/api/budget']) {
    const r = await fetch(base + p);
    ok(r.ok, `GET ${p} ${r.status}`);
  }
  const html = await (await fetch(base + '/')).text();
  ok(html.includes('<title>Ren 2</title>'), 'dashboard served');
  ok(!tgTexts().join('\n').includes('SMOKE:token'), 'bot token never appears in messages');
} catch (e: any) {
  failures++;
  console.error('✘', e.message);
} finally {
  (proc as ChildProcess | null)?.kill("SIGTERM");
  tg.close();
  await sleep(200);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failures ? `\nSMOKE FAILED (${failures})` : '\nSMOKE PASSED');
process.exit(failures ? 1 : 0);
