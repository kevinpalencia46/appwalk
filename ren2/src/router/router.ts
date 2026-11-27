// Model router. config/models.yaml maps each task kind to an ordered list of models.
// We walk the list, skipping providers that are off, unconfigured, down, or blocked by
// the budget, and fall through on errors. Every successful call is logged with its cost.
import path from 'node:path';
import { readYaml } from '../yaml.js';
import { Budget } from '../budget.js';
import { Provider, ProviderStatus, defaultProviders } from './providers.js';
import { log, redact, emit } from '../log.js';

export type Kind = 'chat' | 'plan' | 'code' | 'research' | 'cheap-summarize' | 'embed' | 'write';

export interface ModelDef {
  provider: string;
  id: string;
  in_per_mtok?: number; // USD per million input tokens
  out_per_mtok?: number;
}
export interface ModelsConfig {
  models: Record<string, ModelDef>;
  routes: Record<string, string[]>;
}

export interface CompleteInput {
  kind: Kind;
  prompt: string;
  system?: string;
  agentId?: string | null;
  agentCap?: number;
  taskId?: number | null;
  prefer?: string; // model alias the agent prefers for this kind
  maxTokens?: number;
  signal?: AbortSignal;
}
export interface CompleteOutput {
  text: string;
  model: string;
  provider: string;
  usd: number;
}

export class NoModelError extends Error {
  constructor(public kind: string, public reasons: string[]) {
    super(`no model available for "${kind}": ${reasons.join('; ') || 'route is empty'}`);
  }
}

export class Router {
  cfg: ModelsConfig;
  constructor(
    private budget: Budget,
    configDir: string,
    public providers: Record<string, Provider> = defaultProviders(),
    private off: string[] = [],
  ) {
    this.cfg = readYaml<ModelsConfig>(path.join(configDir, 'models.yaml'), { models: {}, routes: {} });
  }

  candidates(kind: string, prefer?: string): string[] {
    const route = this.cfg.routes[kind] || this.cfg.routes.chat || [];
    return [...new Set([...(prefer ? [prefer] : []), ...route])].filter((m) => this.cfg.models[m]);
  }

  async providerStatus(id: string): Promise<{ status: ProviderStatus; detail?: string }> {
    if (this.off.includes(id)) return { status: 'unavailable', detail: 'disabled by REN2_PROVIDERS_OFF' };
    const p = this.providers[id];
    if (!p) return { status: 'needs_config', detail: 'unknown provider' };
    return p.status();
  }

  async complete(i: CompleteInput): Promise<CompleteOutput> {
    const reasons: string[] = [];
    for (const alias of this.candidates(i.kind, i.prefer)) {
      const def = this.cfg.models[alias];
      const p = this.providers[def.provider];
      const st = await this.providerStatus(def.provider);
      if (st.status !== 'ok') {
        reasons.push(`${alias}: ${st.status}${st.detail ? ` (${st.detail})` : ''}`);
        continue;
      }
      if (p.cloud) {
        const allow = this.budget.allowCloud(i.agentId, i.agentCap);
        if (!allow.ok) {
          reasons.push(`${alias}: ${allow.reason}`);
          continue;
        }
      }
      try {
        emit('model.start', { provider: def.provider, model: alias, kind: i.kind, taskId: i.taskId ?? null });
        const out = await p.call({ model: def.id, prompt: i.prompt, system: i.system, maxTokens: i.maxTokens, signal: i.signal });
        const usd = out.reportedUsd ?? ((out.inTokens * (def.in_per_mtok ?? 0)) + (out.outTokens * (def.out_per_mtok ?? 0))) / 1e6;
        this.budget.record({ provider: def.provider, model: def.id, kind: i.kind, agentId: i.agentId, taskId: i.taskId, usd, tokens: out.inTokens + out.outTokens, cloud: p.cloud });
        emit('model', { provider: def.provider, model: alias, kind: i.kind, taskId: i.taskId ?? null, usd });
        return { text: out.text.trim(), model: alias, provider: def.provider, usd };
      } catch (e: any) {
        if (i.signal?.aborted) throw e;
        const msg = redact(String(e?.message || e)).slice(0, 200);
        log('warn', `router: ${alias} failed, falling back`, msg);
        reasons.push(`${alias}: ${msg}`);
      }
    }
    throw new NoModelError(i.kind, reasons);
  }

  async status() {
    const providers: Record<string, { status: ProviderStatus; detail?: string; cloud: boolean }> = {};
    for (const id of Object.keys(this.providers)) providers[id] = { ...(await this.providerStatus(id)), cloud: this.providers[id].cloud };
    const models = Object.entries(this.cfg.models).map(([alias, d]) => ({ alias, ...d, status: providers[d.provider]?.status ?? 'needs_config' }));
    return { providers, models, routes: this.cfg.routes };
  }
}
