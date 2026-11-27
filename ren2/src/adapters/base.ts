// Project adapters: connect, don't merge. One file per project. Each has status(),
// read methods and action methods; gated actions declare their gate + action type and
// the adapter tool sends them through the gate. Base URL + token come from .env.
//
// MOCK mode (default in the cloud build, where Pi services aren't reachable) serves
// fixture data that is marked `mock: true` and labelled MOCK everywhere it's shown.
// LIVE mode needs each service's real API routes. Until Kevin provides them, live
// methods throw NotMapped — we never invent endpoints.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../env.js';
import type { GateKind } from '../gate/gate.js';

export type AdapterState = 'mock' | 'ok' | 'unreachable' | 'needs_config' | 'not_mapped';

export interface MethodSpec {
  kind: 'read' | 'action';
  description: string;
  gate?: { gate: GateKind; actionType: string };
}

export class NotMapped extends Error {
  constructor(adapter: string, method: string) {
    super(`${adapter}.${method}: live API route not mapped yet — needs the real route from Kevin (VERIFY). Use mock mode until then.`);
  }
}

export interface CallCtx {
  key: string; // idempotency key
  taskId: number;
  agentId: string | null;
  signal?: AbortSignal;
}

export interface AdapterResult {
  mock: boolean;
  text: string; // human/planner-readable
  data?: any;
}

export abstract class Adapter {
  abstract id: string;
  abstract name: string;
  abstract envPrefix: string; // e.g. STOREFRONT → STOREFRONT_URL, STOREFRONT_TOKEN
  abstract defaultUrl: string;
  abstract access: string;
  abstract methods: Record<string, MethodSpec>;
  constructor(public mode: 'mock' | 'live', protected workspace: string) {}

  get baseUrl(): string {
    return process.env[`${this.envPrefix}_URL`] || this.defaultUrl;
  }
  protected get token(): string {
    return process.env[`${this.envPrefix}_TOKEN`] || '';
  }

  fixture<T = any>(name: string): T {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', this.id, `${name}.json`), 'utf8'));
  }

  async status(): Promise<{ state: AdapterState; detail: string }> {
    if (this.mode === 'mock') return { state: 'mock', detail: 'MOCK fixtures — live service not connected from this build' };
    try {
      const r = await fetch(this.baseUrl, { signal: AbortSignal.timeout(2000), headers: this.token ? { authorization: `Bearer ${this.token}` } : {} });
      return { state: 'not_mapped', detail: `reachable at ${this.baseUrl} (HTTP ${r.status}); API routes not mapped yet` };
    } catch {
      return { state: 'unreachable', detail: `no response from ${this.baseUrl}` };
    }
  }

  /** Honest key numbers for the Projects page. */
  abstract keyNumbers(): Promise<{ label: string; value: string | number }[] | null>;

  async call(method: string, args: Record<string, any>, ctx: CallCtx): Promise<AdapterResult> {
    if (!this.methods[method]) throw new Error(`${this.id} has no method ${method} (has: ${Object.keys(this.methods).join(', ')})`);
    if (this.mode === 'live') return this.live(method, args, ctx);
    return this.mock(method, args, ctx);
  }

  protected abstract mock(method: string, args: Record<string, any>, ctx: CallCtx): Promise<AdapterResult>;
  protected async live(method: string, _args: Record<string, any>, _ctx: CallCtx): Promise<AdapterResult> {
    throw new NotMapped(this.id, method);
  }

  /** Mock actions persist to workspace/mock/<adapter>.json so they survive restarts and are idempotent by key. */
  protected mockStore(): { get(k: string): any; put(k: string, v: any): void; all(): Record<string, any> } {
    const file = path.join(this.workspace, 'mock', `${this.id}.json`);
    const load = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
    return {
      get: (k) => load()[k],
      put: (k, v) => {
        const d = load();
        d[k] = v;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(d, null, 1));
      },
      all: load,
    };
  }
}

export function parseJsonLoose(v: unknown): any {
  if (typeof v !== 'string') return v;
  const m = v.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error('expected JSON in the previous step output');
  return JSON.parse(m[0]);
}
