import { Adapter } from './base.js';
import { allAdapters } from './projects.js';

export class Adapters {
  private map = new Map<string, Adapter>();
  constructor(mode: 'mock' | 'live', workspace: string, list: Adapter[] = allAdapters(mode, workspace)) {
    for (const a of list) this.map.set(a.id, a);
  }
  get(id: string) {
    return this.map.get(id);
  }
  list() {
    return [...this.map.values()];
  }
  async statusAll() {
    const out = [];
    for (const a of this.list()) {
      const s = await a.status().catch((e) => ({ state: 'unreachable' as const, detail: String(e.message) }));
      out.push({ id: a.id, name: a.name, access: a.access, mode: a.mode, baseUrl: a.baseUrl, ...s, methods: a.methods });
    }
    return out;
  }
}
