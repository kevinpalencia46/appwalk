// Telegram bot over the Bot API with long polling (getUpdates). Chat-locked to
// TELEGRAM_CHAT_ID — every other chat is ignored. Free text → the planner. Commands:
// /status /agents /pause <a> /resume [a] /stop /budget [usd] /decisions /new <objective>.
// Decisions arrive with inline buttons: Approve · Edit · Reject · Always allow this.
import type { Core } from '../core.js';
import type { Decision } from '../gate/gate.js';
import { kvGet, kvSet, kvDel } from '../db.js';
import { log, redact } from '../log.js';

const MAX = 3800;
const clip = (s: string) => (s.length > MAX ? s.slice(0, MAX - 20) + '\n…(more on dashboard)' : s);

export class Telegram {
  private running = false;
  private ac: AbortController | null = null;
  sent: { method: string; body: any }[] = []; // last few calls, for tests/diagnostics
  constructor(private core: Core) {}

  configured(): boolean {
    return Boolean(this.core.settings.telegramToken && this.core.settings.telegramChatId);
  }
  status() {
    if (!this.core.settings.telegramToken) return { status: 'needs_credentials', detail: 'TELEGRAM_BOT_TOKEN not set' };
    if (!this.core.settings.telegramChatId) return { status: 'needs_config', detail: 'TELEGRAM_CHAT_ID not set' };
    return { status: this.running ? 'ok' : 'unavailable', detail: this.running ? 'long polling' : 'not started', lastError: kvGet(this.core.db, 'tg.last_error') };
  }

  async api(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const s = this.core.settings;
    const r = await fetch(`${s.telegramApiBase}/bot${s.telegramToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    const d: any = await r.json().catch(() => ({}));
    if (method !== 'getUpdates') {
      this.sent.push({ method, body });
      if (this.sent.length > 50) this.sent.shift();
    }
    if (!d.ok) throw new Error(`telegram ${method}: ${d.description || r.status}`);
    return d.result;
  }

  async send(text: string, extra: Record<string, unknown> = {}): Promise<number | null> {
    if (!this.configured()) return null;
    try {
      const m = await this.api('sendMessage', { chat_id: this.core.settings.telegramChatId, text: clip(redact(text)), disable_web_page_preview: true, ...extra });
      return m.message_id;
    } catch (e: any) {
      kvSet(this.core.db, 'tg.last_error', String(e.message).slice(0, 300));
      log('warn', 'telegram send failed', redact(String(e.message)));
      return null;
    }
  }
  async notify(text: string): Promise<boolean> {
    return (await this.send(text)) !== null;
  }

  link(hash: string): string {
    const base = this.core.settings.dashboardUrl;
    return base ? `\n${base.replace(/\/$/, '')}/#${hash}` : '';
  }

  async sendDecision(d: Decision): Promise<void> {
    const gateIcon = { money: '💳', publish: '📣', contact: '✉️', destroy: '🗑' }[d.gate] || '❓';
    const text = `${gateIcon} Decision #${d.id} · ${d.gate}${d.agent_id ? ` · ${d.agent_id}` : ''}\n${d.summary}${d.preview ? `\n\n${d.preview.slice(0, 2500)}` : ''}${this.link(`home`)}`;
    const mid = await this.send(text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `d:${d.id}:a` },
            { text: '✏️ Edit', callback_data: `d:${d.id}:e` },
          ],
          [
            { text: '✖ Reject', callback_data: `d:${d.id}:r` },
            { text: '♾ Always allow this', callback_data: `d:${d.id}:al` },
          ],
        ],
      },
    });
    if (mid) this.core.gate.setMessageId(d.id, String(mid));
  }

  start(): void {
    if (!this.configured() || this.running) return;
    this.running = true;
    this.ac = new AbortController();
    void this.loop();
  }
  stop(): void {
    this.running = false;
    this.ac?.abort();
  }

  private async loop(): Promise<void> {
    let backoff = 1000;
    while (this.running) {
      try {
        const offset = Number(kvGet(this.core.db, 'tg.offset') || 0);
        const updates: any[] = await this.api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, AbortSignal.any([this.ac!.signal, AbortSignal.timeout(40_000)]));
        for (const u of updates) {
          kvSet(this.core.db, 'tg.offset', String(u.update_id + 1));
          await this.handle(u).catch((e) => log('warn', 'telegram handler error', String(e.message)));
        }
        backoff = 1000;
      } catch (e: any) {
        if (!this.running) return;
        kvSet(this.core.db, 'tg.last_error', redact(String(e.message)).slice(0, 300));
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  private mine(chatId: unknown): boolean {
    return String(chatId) === String(this.core.settings.telegramChatId);
  }

  async handle(u: any): Promise<void> {
    if (u.callback_query) {
      const q = u.callback_query;
      if (!this.mine(q.message?.chat?.id)) return;
      await this.onButton(q).catch(async (e) => {
        await this.api('answerCallbackQuery', { callback_query_id: q.id, text: String(e.message).slice(0, 180) }).catch(() => {});
      });
      return;
    }
    const m = u.message;
    if (!m || !this.mine(m.chat?.id)) return; // chat-locked
    const text = String(m.text || '').trim();
    if (!text) return;
    if (text.startsWith('/')) return this.onCommand(text);
    const pendingEdit = kvGet(this.core.db, 'tg.pending_edit');
    if (pendingEdit) {
      kvDel(this.core.db, 'tg.pending_edit');
      this.core.decide(Number(pendingEdit), 'edit', text, 'telegram');
      await this.send(`✏️ Got it — revising decision #${pendingEdit}. I'll ask again when it's ready.`);
      return;
    }
    const t = this.core.chat('telegram', text, String(m.chat.id));
    await this.send(`On it (task #${t.id}).`);
  }

  private async onButton(q: any): Promise<void> {
    const m = String(q.data || '').match(/^d:(\d+):(a|e|r|al)$/);
    if (!m) return;
    const id = Number(m[1]);
    const act = { a: 'approve', e: 'edit', r: 'reject', al: 'always' }[m[2]] as 'approve' | 'edit' | 'reject' | 'always';
    if (act === 'edit') {
      const d = this.core.gate.get(id);
      if (!d || !['pending', 'stale'].includes(d.status)) throw new Error(`decision #${id} is ${d?.status ?? 'gone'}`);
      kvSet(this.core.db, 'tg.pending_edit', String(id));
      await this.api('answerCallbackQuery', { callback_query_id: q.id, text: 'Reply with your changes' });
      await this.send(`✏️ What should change in #${id}? Reply with your edit.`, { reply_markup: { force_reply: true } });
      return;
    }
    const d = this.core.decide(id, act, undefined, 'telegram');
    const label = { approve: '✅ Approved', reject: '✖ Rejected', always: `♾ Approved + always allow ${d.action_type} for ${d.agent_id}` }[act];
    await this.api('answerCallbackQuery', { callback_query_id: q.id, text: label });
    await this.api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await this.send(`${label} — decision #${id}.`);
  }

  async onCommand(text: string): Promise<void> {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, '');
    const arg = rest.join(' ').trim();
    const c = this.core;
    try {
      switch (cmd) {
        case '/start':
        case '/help':
          return void (await this.send('Ren 2. Talk to me in plain words, or:\n/status /agents /decisions /budget [usd]\n/pause <agent> /resume [agent]\n/new <objective>\n/stop (kill switch) · /resume'));
        case '/status':
          return void (await this.send(c.statusText() + this.link('home')));
        case '/agents':
          return void (await this.send(c.agentsText() + this.link('agents')));
        case '/pause':
          if (!arg) return void (await this.send('Usage: /pause <agent>'));
          c.agents.setStatus(arg, 'paused');
          return void (await this.send(`⏸ ${arg} paused.`));
        case '/resume':
          if (arg) {
            c.agents.setStatus(arg, 'running');
            return void (await this.send(`▶️ ${arg} running.`));
          }
          c.runner.resume('telegram');
          return void (await this.send('▶️ Resumed. Agents and tasks are running again.'));
        case '/stop':
          c.runner.kill('telegram');
          return void (await this.send('🛑 Stopped. All agents and in-flight tasks halted. /resume to restart.'));
        case '/budget': {
          if (arg) {
            const v = Number(arg.replace('$', ''));
            if (!(v >= 0)) return void (await this.send('Usage: /budget 10  (sets today\'s cap in USD)'));
            c.budget.setCap(v, true);
          }
          return void (await this.send(c.budgetText()));
        }
        case '/decisions':
          return void (await this.decisions());
        case '/new':
          if (!arg) return void (await this.send('Usage: /new <objective>'));
          return void (await this.send(`Queued task #${c.chat('telegram', arg, c.settings.telegramChatId, true).id}.`));
        default:
          return void (await this.send(`Unknown command ${cmd}. /help`));
      }
    } catch (e: any) {
      await this.send(`⚠ ${e.message}`);
    }
  }

  private async decisions(): Promise<void> {
    const open = this.core.gate.open();
    if (!open.length) return void (await this.send('No pending decisions.'));
    await this.send(`${open.length} pending decision(s):`);
    for (const d of open.slice(0, 5)) await this.sendDecision(d);
  }
}
