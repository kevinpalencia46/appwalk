// Telegram against a fake Bot API: chat lock, commands, decisions with buttons, edit flow,
// kill switch, long polling loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { makeCore, runToEnd, waitFor } from './helpers.js';

function fakeBotApi() {
  const calls: { method: string; body: any }[] = [];
  const updates: any[] = [];
  let mid = 100;
  const srv = http.createServer((req, res) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      const method = req.url!.split('/').pop()!;
      const body = s ? JSON.parse(s) : {};
      calls.push({ method, body });
      let result: any = true;
      if (method === 'sendMessage') result = { message_id: ++mid };
      if (method === 'getUpdates') result = updates.splice(0).filter((u) => u.update_id >= (body.offset || 0));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  return new Promise<{ base: string; calls: typeof calls; updates: any[]; close: () => void }>((resolve) =>
    srv.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls, updates, close: () => srv.close() })),
  );
}

const msg = (chat: number, text: string, id = Math.floor(Math.random() * 1e6)) => ({ update_id: id, message: { message_id: id, chat: { id: chat }, text } });
const sent = (calls: any[]) => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text as string);

test('telegram: chat-locked; free text → planner → answer; commands', async () => {
  const api = await fakeBotApi();
  const { core, providers } = makeCore({ settings: { telegramToken: 'TEST:token', telegramChatId: '42', telegramApiBase: api.base } });
  (providers.anthropic as any).reply = () => 'Storefront has ~1,000 visits and 0 orders (#1).';
  core.memory.indexNotes();

  await core.telegram.handle(msg(999, 'hi from a stranger'));
  assert.equal(core.tasks.list().length, 0, 'other chats ignored');

  await core.telegram.handle(msg(42, 'summarize what is in memory about Storefront'));
  const t = core.tasks.list()[0];
  assert.equal(t.source, 'telegram');
  await runToEnd(core, t.id);
  await waitFor(() => sent(api.calls).some((s) => s.includes('0 orders')), 3000, 'answer sent');

  await core.telegram.onCommand('/status');
  assert.ok(sent(api.calls).some((s) => s.startsWith('Ren 2')));
  await core.telegram.onCommand('/pause analyst');
  assert.equal(core.agents.status('analyst'), 'paused');
  await core.telegram.onCommand('/resume analyst');
  assert.equal(core.agents.status('analyst'), 'running');
  await core.telegram.onCommand('/budget 7');
  assert.equal(core.budget.cap(), 7);
  await core.telegram.onCommand('/agents');
  assert.ok(sent(api.calls).some((s) => s.includes('Storefront Analyst (analyst)')));
  await core.telegram.onCommand('/new check the builder');
  assert.ok(core.tasks.list().some((x) => x.objective === 'check the builder'));
  await core.telegram.onCommand('/stop');
  assert.equal(core.runner.halted(), true);
  await core.telegram.onCommand('/resume');
  assert.equal(core.runner.halted(), false);
  await core.stop();
  api.close();
});

test('telegram: decision buttons — approve, edit by reply, always allow; secrets never sent', async () => {
  const api = await fakeBotApi();
  const { core, providers } = makeCore({ settings: { telegramToken: 'TEST:token', telegramChatId: '42', telegramApiBase: api.base } });
  (providers.anthropic as any).reply = () => 'Revised post';
  const plan = [
    { tool: 'publish', args: { action: 'draft', platform: 'drafts', text: 'Post v1' } },
    { tool: 'publish', args: { action: 'publish', platform: 'drafts', draft_id: '{{data.0.id}}', text: 'Post v1' } },
  ];
  const t = core.tasks.create({ objective: 'post', agentId: 'media', kind: 'agent', plan });
  await runToEnd(core, t.id);
  const d = core.gate.open()[0];
  await core.telegram.sendDecision(d);
  const dm = api.calls.filter((c) => c.method === 'sendMessage').at(-1)!.body;
  const buttons = dm.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
  assert.deepEqual(buttons, ['✅ Approve', '✏️ Edit', '✖ Reject', '♾ Always allow this']);

  // Edit: press button, then reply with text
  await core.telegram.handle({ update_id: 1, callback_query: { id: 'q1', data: `d:${d.id}:e`, message: { message_id: 5, chat: { id: 42 } } } });
  await core.telegram.handle(msg(42, 'make it punchier'));
  assert.equal(core.gate.get(d.id)!.status, 'edit_requested');
  await runToEnd(core, t.id);
  const d2 = core.gate.open()[0];
  assert.match(d2.preview!, /Revised post/);

  // Always allow
  await core.telegram.handle({ update_id: 2, callback_query: { id: 'q2', data: `d:${d2.id}:al`, message: { message_id: 6, chat: { id: 42 } } } });
  assert.equal(core.gate.get(d2.id)!.status, 'approved');
  assert.deepEqual(core.agents.get('media')!.auto, ['post:drafts']);
  await runToEnd(core, t.id, ['done']);

  // Buttons from another chat are ignored
  const t2 = core.tasks.create({ objective: 'post2', plan });
  await runToEnd(core, t2.id);
  const d3 = core.gate.open()[0];
  await core.telegram.handle({ update_id: 3, callback_query: { id: 'q3', data: `d:${d3.id}:a`, message: { message_id: 7, chat: { id: 1 } } } });
  assert.equal(core.gate.get(d3.id)!.status, 'pending');

  assert.ok(!JSON.stringify(api.calls).includes('TEST:token'));
  await core.stop();
  api.close();
});

test('telegram: long-poll loop picks up updates and advances the offset', async () => {
  const api = await fakeBotApi();
  const { core } = makeCore({ settings: { telegramToken: 'TEST:token', telegramChatId: '42', telegramApiBase: api.base } });
  api.updates.push(msg(42, '/status', 10));
  core.telegram.start();
  await waitFor(() => sent(api.calls).some((s) => s.startsWith('Ren 2')), 3000, 'status reply');
  core.telegram.stop();
  assert.equal(core.db.prepare("SELECT value FROM kv WHERE key = 'tg.offset'").get()!.value, '11');
  await core.stop();
  api.close();
});
