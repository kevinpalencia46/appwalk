import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, settings, Settings } from '../src/env.js';
import { Core } from '../src/core.js';
import type { Provider, CallInput } from '../src/router/providers.js';

process.env.REN2_LOG = 'quiet';

export function tmpdir(prefix = 'ren2-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface FakeProvider extends Provider {
  calls: CallInput[];
  reply: (i: CallInput) => string | Promise<string>;
  state: 'ok' | 'needs_credentials' | 'unavailable';
  fail: boolean;
}

export function fake(id: string, cloud: boolean, reply: (i: CallInput) => string | Promise<string> = (i) => `ok from ${id}: ${i.prompt.slice(0, 40)}`): FakeProvider {
  const p: FakeProvider = {
    id,
    cloud,
    calls: [],
    reply,
    state: 'ok',
    fail: false,
    async status() {
      return { status: p.state };
    },
    async call(i) {
      p.calls.push(i);
      if (p.fail) throw new Error(`${id} boom`);
      const text = await p.reply(i);
      return { text, inTokens: 1000, outTokens: 500 };
    },
  };
  return p;
}

export function off(id: string): FakeProvider {
  const p = fake(id, true);
  p.state = 'needs_credentials';
  return p;
}

export function testSettings(dir: string, over: Partial<Settings> = {}): Settings {
  const agentsDir = path.join(dir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'agents'))) fs.copyFileSync(path.join(ROOT, 'agents', f), path.join(agentsDir, f));
  const knowledgeDir = path.join(dir, 'knowledge');
  fs.mkdirSync(path.join(knowledgeDir, 'storefront'), { recursive: true });
  fs.writeFileSync(path.join(knowledgeDir, 'storefront', 'facts.md'), '---\nproject: storefront\nkind: fact\n---\n# Storefront traffic\n\nStorefront has about 1,000 visits and 0 orders.\n');
  return {
    ...settings(),
    dataDir: path.join(dir, 'data'),
    dbPath: path.join(dir, 'data', 'ren2.db'),
    workspace: path.join(dir, 'workspace'),
    knowledgeDir,
    agentsDir,
    configDir: path.join(ROOT, 'config'),
    ownerToken: '',
    telegramToken: '',
    telegramChatId: '',
    tickMs: 25,
    adapterMode: 'mock',
    dailyBudgetUsd: 5,
    providersOff: [],
    ...over,
  };
}

export function makeCore(o: { dir?: string; providers?: Record<string, Provider>; settings?: Partial<Settings> } = {}) {
  const dir = o.dir ?? tmpdir();
  const s = testSettings(dir, o.settings);
  const providers = o.providers ?? { anthropic: fake('anthropic', true), deepseek: off('deepseek'), kimi: off('kimi'), ollama: fake('ollama', false), claude_code: off('claude_code') };
  const core = new Core(s, { providers });
  return { core, dir, s, providers };
}

export async function waitFor<T>(fn: () => T | undefined | null | false, ms = 5000, label = 'condition'): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export async function runToEnd(core: Core, taskId: number, states = ['done', 'failed', 'needs_decision'], ms = 5000) {
  core.runner.tick();
  return waitFor(() => {
    core.runner.tick();
    const t = core.tasks.get(taskId)!;
    return states.includes(t.state) && !core.runner.active.has(taskId) ? t : undefined;
  }, ms, `task ${taskId} → ${states.join('|')}`);
}
