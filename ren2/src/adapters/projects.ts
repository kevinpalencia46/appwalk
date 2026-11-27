// The seven project adapters. Mock implementations only — live routes are unmapped
// (see base.ts). Read-only adapters (meme, trading, old Ren) expose no actions at all:
// Ren 2 never places, queues or enables trades.
import fs from 'node:fs';
import path from 'node:path';
import { Adapter, AdapterResult, CallCtx, MethodSpec, parseJsonLoose } from './base.js';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mock = (text: string, data?: any): AdapterResult => ({ mock: true, text: `[MOCK] ${text}`, data: data === undefined ? undefined : { ...data, mock: true } });

/** Storefronts: watches every web property — Worklane, the book site, the shop, and later
 *  Amazon resale / dropshipping / clothes / toys. Worklane demo sign-ups come from here. */
export class Storefront extends Adapter {
  id = 'storefront';
  name = 'Storefronts';
  envPrefix = 'STOREFRONT';
  defaultUrl = 'http://127.0.0.1:8200';
  access = 'read all properties + create candidate products (go-live is gated)';
  methods: Record<string, MethodSpec> = {
    properties: { kind: 'read', description: 'every web property/storefront we run (and planned ones)' },
    summary: { kind: 'read', description: 'analytics for one property: visits, conversions, sales/sign-ups, traffic (args: property)' },
    pages: { kind: 'read', description: 'page copy for one property (args: property)' },
    signups: { kind: 'read', description: 'Worklane demo sign-ups (people asking us to build them a demo)' },
    products: { kind: 'read', description: 'product list with prices (shop)' },
    create_candidate: { kind: 'action', description: 'create a draft (not live) product' },
    go_live: { kind: 'action', description: 'make a product live', gate: { gate: 'publish', actionType: 'product:go_live' } },
  };
  private prop(a: Record<string, any>): string {
    return String(a.property || 'shop');
  }
  async keyNumbers() {
    if (this.mode !== 'mock') return null;
    const props = this.fixture<any[]>('properties').filter((p) => p.status === 'live');
    return props.map((p) => {
      const s = this.fixture('summaries')[p.id];
      return { label: `${p.name}: ${s.conversion_label} (30d) MOCK`, value: `${s.conversions_30d} / ${s.visits_30d} visits` };
    });
  }
  protected async mock(m: string, a: Record<string, any>, ctx: CallCtx) {
    if (m === 'properties') {
      const p = this.fixture<any[]>('properties');
      return mock(p.map((x) => `${x.id}: ${x.name} — ${x.kind}, ${x.status}${x.url ? ` (${x.url})` : ''}`).join('\n'), { properties: p });
    }
    if (m === 'summary') {
      const all = this.fixture('summaries');
      const id = this.prop(a);
      const s = all[id];
      if (!s) throw new Error(`no analytics for property "${id}" (known: ${Object.keys(all).join(', ')})`);
      return mock(
        `${s.name} last 30 days: ${s.visits_30d} visits (${s.unique_visitors_30d} unique), ${s.funnel.map((f: any) => `${f.step} ${f.count}`).join(' → ')}, ${s.conversions_30d} ${s.conversion_label}. Traffic: ${s.traffic_sources.map((t: any) => `${t.source} ${t.visits}`).join(', ')}. Top pages: ${s.top_pages.map((p: any) => `${p.path} (${p.visits}, bounce ${p.bounce_pct}%)`).join('; ')}. Mobile ${s.mobile_pct}%.`,
        s,
      );
    }
    if (m === 'pages') {
      const all = this.fixture('pages');
      const p = all[this.prop(a)] || [];
      return mock(p.map((x: any) => `### ${x.path}\n${x.copy}`).join('\n\n') || 'no pages', { pages: p });
    }
    if (m === 'signups') {
      const s = this.fixture<any[]>('signups');
      return mock(s.length ? s.map((x) => `${x.id}: ${x.business} (${x.niche}, ${x.city}) — ${x.wants} · ${x.at}`).join('\n') : 'no new sign-ups', { signups: s });
    }
    if (m === 'products') {
      const p = this.fixture<any[]>('products');
      return mock(p.map((x) => `${x.name} — $${x.price} (${x.status})`).join('\n'), { products: p });
    }
    const store = this.mockStore();
    if (m === 'create_candidate') {
      const prev = store.get(ctx.key);
      if (prev) return mock(`candidate already created: ${prev.name}`, prev);
      const rec = { id: `cand-${ctx.taskId}`, name: a.name, price: a.price, status: 'draft' };
      store.put(ctx.key, rec);
      return mock(`created draft product ${a.name}`, rec);
    }
    if (m === 'go_live') {
      store.put(`live:${a.product_id}`, { at: new Date().toISOString() });
      return mock(`product ${a.product_id} marked live (mock store only — nothing changed on the real Storefront)`, { product_id: a.product_id });
    }
    throw new Error(`unhandled ${m}`);
  }
}

/** Builder: builds sites, sweeps areas for local businesses with no/outdated sites,
 *  rates them, and handles outreach to them (sending is gated). */
export class Builder extends Adapter {
  id = 'builder';
  name = 'Builder';
  envPrefix = 'BUILDER';
  defaultUrl = 'http://127.0.0.1:8400';
  access = 'read + build + sweep + outreach drafts (publish and send are gated)';
  methods: Record<string, MethodSpec> = {
    sites: { kind: 'read', description: 'list sites + previews' },
    candidates: { kind: 'read', description: 'swept local businesses with their rating (args: area?, min_score?)' },
    sweep: { kind: 'action', description: 'sweep an area for businesses with no or outdated websites and rate them (args: area)' },
    create_site: { kind: 'action', description: 'build a preview site from a spec (args: spec, candidate_id?)' },
    publish_site: { kind: 'action', description: 'deploy a site to its public URL', gate: { gate: 'publish', actionType: 'deploy:public' } },
    outreach_draft: { kind: 'action', description: 'save an outreach email to a candidate (not sent)' },
    outreach_send: { kind: 'action', description: 'send outreach emails to candidates', gate: { gate: 'contact', actionType: 'email:send' } },
  };
  async keyNumbers() {
    if (this.mode !== 'mock') return null;
    const all = this.mockStore().all();
    const sites = Object.values(all).filter((v: any) => v?.preview_url).length;
    const cands = Object.values(all).filter((v: any) => v?.swept).reduce((n: number, v: any) => n + v.candidates.length, 0);
    return [
      { label: 'Demo sites built (local mock)', value: sites },
      { label: 'Candidates swept (fixture data)', value: cands },
    ];
  }
  private swept(): any[] {
    return Object.values(this.mockStore().all()).filter((v: any) => v?.swept).flatMap((v: any) => v.candidates);
  }
  protected async mock(m: string, a: Record<string, any>, ctx: CallCtx) {
    const store = this.mockStore();
    if (m === 'sites') {
      const all = Object.values(store.all()).filter((v: any) => v?.preview_url);
      return mock(all.length ? all.map((s: any) => `${s.id}: ${s.title} — ${s.preview_url}${s.candidate_id ? ` (for ${s.candidate_id})` : ''}`).join('\n') : 'no sites yet', { sites: all });
    }
    if (m === 'sweep') {
      const prev = store.get(ctx.key);
      if (prev) return mock(`area already swept: ${prev.area} (${prev.candidates.length} candidates)`, prev);
      const area = String(a.area || '').trim();
      if (!area) throw new Error('sweep needs an area');
      const found = this.fixture<any[]>('candidates').filter((c) => c.area.toLowerCase() === area.toLowerCase());
      const rec = { swept: true, area, at: new Date().toISOString(), candidates: found };
      store.put(ctx.key, rec);
      return mock(
        found.length ? `Swept ${area}: ${found.length} candidates.\n${found.map((c) => `${c.id} ${c.business} (${c.niche}) — score ${c.score}/10: ${c.reason}`).join('\n')}` : `Swept ${area}: no candidates in the fixture data for this area.`,
        rec,
      );
    }
    if (m === 'candidates') {
      const min = Number(a.min_score || 0);
      const list = this.swept()
        .filter((c) => (!a.area || c.area.toLowerCase() === String(a.area).toLowerCase()) && c.score >= min)
        .sort((x, y) => y.score - x.score);
      return mock(list.length ? list.map((c) => `${c.id} ${c.business} (${c.niche}, ${c.area}) — ${c.score}/10: ${c.reason}`).join('\n') : 'no candidates yet — run a sweep', { candidates: list });
    }
    if (m === 'create_site') {
      const prev = store.get(ctx.key);
      if (prev) return mock(`preview already built: ${prev.preview_url}`, prev);
      const spec = parseJsonLoose(a.spec);
      const slug = String(spec.name || spec.title || `site-${ctx.taskId}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `site-${ctx.taskId}`;
      const id = `${slug}-${ctx.taskId}`;
      const dir = path.join(this.workspace, 'previews', id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), renderSite(spec));
      const base = process.env.REN2_DASHBOARD_URL || `http://127.0.0.1:${process.env.REN2_PORT || 8700}`;
      const rec = { id, title: spec.title || slug, niche: spec.niche || a.niche || null, candidate_id: a.candidate_id || null, preview_url: `${base.replace(/\/$/, '')}/previews/${id}/`, live: false };
      store.put(ctx.key, rec);
      return mock(`preview built for "${rec.title}": ${rec.preview_url} (rendered locally by Ren 2's mock Builder)`, rec);
    }
    if (m === 'publish_site') {
      return mock(`site ${a.site_id} would now be deployed publicly — mock Builder has no public host, nothing was deployed`, { site_id: a.site_id, deployed: false });
    }
    if (m === 'outreach_draft') {
      const prev = store.get(ctx.key);
      if (prev) return mock(`draft already saved for ${prev.candidate_id}`, prev);
      const rec = { outreach: true, candidate_id: a.candidate_id, subject: a.subject, body: a.body, sent: false };
      store.put(ctx.key, rec);
      return mock(`outreach draft saved for ${a.candidate_id}`, rec);
    }
    if (m === 'outreach_send') {
      return mock(`outreach to ${a.candidate_id || 'candidates'} marked sent in the mock store — no email left this machine`, { sent: false });
    }
    throw new Error(`unhandled ${m}`);
  }
}

export function renderSite(s: any): string {
  const sections = (s.sections || []).map((x: any) => `<section><h2>${esc(x.heading)}</h2><p>${esc(x.body)}</p></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.title)}</title>
<style>body{margin:0;font:17px/1.55 system-ui,sans-serif;color:#1c1d20;background:#fafaf7}header{padding:72px 20px 48px;background:#15171a;color:#fff;text-align:center}h1{font-size:clamp(28px,5vw,48px);margin:0 0 12px}header p{opacity:.8;max-width:640px;margin:0 auto 28px}a.cta{display:inline-block;background:#F4C87A;color:#15171a;padding:14px 26px;border-radius:10px;text-decoration:none;font-weight:600}main{max-width:760px;margin:0 auto;padding:32px 20px}section{padding:18px 0;border-bottom:1px solid #e4e4df}footer{padding:28px 20px;text-align:center;color:#777;font-size:13px}.mock{background:#ffe9b3;color:#5a4200;text-align:center;padding:6px;font-size:13px}</style></head>
<body><div class="mock">Preview — not published</div><header><h1>${esc(s.headline || s.title)}</h1><p>${esc(s.subhead)}</p><a class="cta" href="${esc(s.cta?.href || '#contact')}">${esc(s.cta?.label || 'Get in touch')}</a></header><main>${sections}<section id="contact"><h2>Contact</h2><p>Contact details go here.</p></section></main><footer>${esc(s.title)}</footer></body></html>`;
}

/** Showrunner: script → voice → render, clips, thumbnails, and (soon) posting to each
 *  platform. Channel analytics come from here too. */
export class Showrunner extends Adapter {
  id = 'showrunner';
  name = 'Showrunner';
  envPrefix = 'SHOWRUNNER';
  defaultUrl = 'http://127.0.0.1:8300';
  access = 'read + make videos/clips/thumbnails (posting is gated per platform)';
  methods: Record<string, MethodSpec> = {
    channels: { kind: 'read', description: 'our channels (YouTube, Instagram, TikTok…) with followers and totals' },
    analytics: { kind: 'read', description: 'recent videos per channel: views, retention, likes, follows gained (args: channel?)' },
    jobs: { kind: 'read', description: 'content jobs and their state' },
    queue_job: { kind: 'action', description: 'queue a script → voice → render video job (args: script, title, niche?)' },
    make_clips: { kind: 'action', description: 'cut a rendered video into short clips (args: job_id)' },
    make_thumbnail: { kind: 'action', description: 'generate a thumbnail (args: job_id, idea?)' },
    publish_render: { kind: 'action', description: 'post a video/clip to a platform (args: job_id, platform)', gate: { gate: 'publish', actionType: 'video:publish' } },
  };
  async keyNumbers() {
    if (this.mode !== 'mock') return null;
    return this.fixture<any[]>('channels').map((c) => ({ label: `${c.platform} followers MOCK`, value: c.followers }));
  }
  protected async mock(m: string, a: Record<string, any>, ctx: CallCtx) {
    const store = this.mockStore();
    if (m === 'channels') {
      const c = this.fixture<any[]>('channels');
      return mock(c.map((x) => `${x.platform} "${x.name}": ${x.followers} followers, ${x.videos} videos, ${x.views_28d} views (28d)${x.watch_hours_12m !== undefined ? `, ${x.watch_hours_12m} watch hours (12m)` : ''}`).join('\n'), { channels: c });
    }
    if (m === 'analytics') {
      const all = this.fixture<any[]>('analytics').filter((v) => !a.channel || v.platform === a.channel);
      return mock(all.map((v) => `[${v.platform}] "${v.title}" (${v.niche}, ${v.format}) — ${v.views} views, ${v.avg_view_pct}% watched, ${v.likes} likes, +${v.follows} follows`).join('\n'), { videos: all });
    }
    if (m === 'jobs') {
      const all = Object.values(store.all()).filter((j: any) => j?.kind === 'video');
      return mock(all.length ? all.map((j: any) => `${j.id} ${j.title} — ${j.state}${j.clips ? `, ${j.clips} clips` : ''}${j.thumbnail ? ', thumbnail ready' : ''}`).join('\n') : 'no jobs', { jobs: all });
    }
    if (m === 'queue_job') {
      const prev = store.get(ctx.key);
      if (prev) return mock(`job already queued: ${prev.id}`, prev);
      if (!a.script || String(a.script).startsWith('(optional step failed')) throw new Error('no script to queue');
      const rec = { kind: 'video', id: `job-${ctx.taskId}`, title: a.title || 'untitled', niche: a.niche || null, state: 'queued (mock — no render happens)', script: String(a.script).slice(0, 4000) };
      store.put(ctx.key, rec);
      store.put(`job:${rec.id}`, rec);
      return mock(`queued Showrunner job ${rec.id}`, rec);
    }
    if (m === 'make_clips' || m === 'make_thumbnail') {
      const job = store.get(`job:${a.job_id}`);
      if (!job) throw new Error(`no job ${a.job_id}`);
      const next = m === 'make_clips' ? { ...job, clips: Number(a.count || 3) } : { ...job, thumbnail: `thumb-${a.job_id}.png (mock)` };
      store.put(`job:${a.job_id}`, next);
      return mock(m === 'make_clips' ? `${next.clips} clips cut from ${a.job_id} (mock)` : `thumbnail made for ${a.job_id} (mock)`, next);
    }
    if (m === 'publish_render') return mock(`${a.job_id} would be posted to ${a.platform || 'the platform'} — mock, nothing posted`, { job_id: a.job_id, platform: a.platform, posted: false });
    throw new Error(`unhandled ${m}`);
  }
}

export class GrowthEngine extends Adapter {
  id = 'bge';
  name = 'Growth Engine';
  envPrefix = 'BGE';
  defaultUrl = 'http://127.0.0.1:8601';
  access = 'read + draft (send is gated)';
  methods: Record<string, MethodSpec> = {
    leads: { kind: 'read', description: 'CRM leads' },
    prospects: { kind: 'read', description: 'prospects matching a segment (local trades businesses)' },
    create_drafts: { kind: 'action', description: 'save outreach drafts in BGE (not sent)' },
    send_drafts: { kind: 'action', description: 'send outreach drafts', gate: { gate: 'contact', actionType: 'email:send' } },
  };
  async keyNumbers() {
    if (this.mode !== 'mock') return null;
    return [
      { label: 'Leads MOCK', value: this.fixture<any[]>('leads').length },
      { label: 'Drafts by Ren 2 (mock)', value: Object.keys(this.mockStore().all()).filter((k) => !k.startsWith('sent:')).length },
    ];
  }
  protected async mock(m: string, a: Record<string, any>, ctx: CallCtx) {
    const store = this.mockStore();
    if (m === 'leads') {
      const l = this.fixture<any[]>('leads');
      return mock(l.map((x) => `${x.name} (${x.stage})`).join('\n'), { leads: l });
    }
    if (m === 'prospects') {
      const p = this.fixture<any[]>('prospects').filter((x) => !a.segment || x.segment === a.segment).slice(0, Number(a.limit || 5));
      return mock(p.map((x) => `${x.id}: ${x.business} — ${x.trade}, ${x.city}. ${x.notes}`).join('\n'), { prospects: p });
    }
    if (m === 'create_drafts') {
      const prev = store.get(ctx.key);
      if (prev) return mock(`drafts already saved: ${prev.ids.join(', ')}`, prev);
      const msgs = parseJsonLoose(a.messages);
      if (!Array.isArray(msgs) || !msgs.length) throw new Error('no messages to save');
      const rec = { ids: msgs.map((_: any, i: number) => `draft-${ctx.taskId}-${i + 1}`), count: msgs.length };
      store.put(ctx.key, rec);
      return mock(`saved ${msgs.length} drafts in Growth Engine`, rec);
    }
    if (m === 'send_drafts') {
      const prev = store.get(`sent:${ctx.key}`);
      if (prev) return mock(`already sent ${prev.count}`, prev);
      const ids = Array.isArray(a.draft_ids) ? a.draft_ids : [];
      const rec = { count: ids.length, ids, sent: false };
      store.put(`sent:${ctx.key}`, rec);
      return mock(`${ids.length} drafts marked sent in the mock store — no email left this machine`, rec);
    }
    throw new Error(`unhandled ${m}`);
  }
}

abstract class ReadOnly extends Adapter {
  protected async mock(m: string): Promise<AdapterResult> {
    const d = this.fixture(m);
    return mock(this.describe(m, d), d);
  }
  protected abstract describe(m: string, d: any): string;
}

export class MemeScanner extends ReadOnly {
  id = 'meme';
  name = 'Meme Scanner';
  envPrefix = 'MEME';
  defaultUrl = 'http://127.0.0.1:8500';
  access = 'read only';
  methods: Record<string, MethodSpec> = { signals: { kind: 'read', description: 'signal summaries' } };
  async keyNumbers() {
    return this.mode === 'mock' ? [{ label: 'Signals today MOCK', value: this.fixture('signals').signals.length }] : null;
  }
  protected describe(_m: string, d: any) {
    return d.signals.map((s: any) => `${s.symbol}: ${s.summary} (score ${s.score})`).join('\n');
  }
}

export class TradingOS extends ReadOnly {
  id = 'trading';
  name = 'Trading OS';
  envPrefix = 'TRADING';
  defaultUrl = 'http://127.0.0.1:8000';
  access = 'read only (paper results) — Ren 2 never trades';
  methods: Record<string, MethodSpec> = { paper_results: { kind: 'read', description: 'paper-trading results' } };
  async keyNumbers() {
    if (this.mode !== 'mock') return null;
    const p = this.fixture('paper_results');
    return [
      { label: 'Paper P&L (30d) MOCK', value: `${p.pnl_pct_30d}%` },
      { label: 'Paper trades MOCK', value: p.trades_30d },
    ];
  }
  protected describe(_m: string, d: any) {
    return `Paper results (30d): ${d.pnl_pct_30d}% over ${d.trades_30d} trades, win rate ${d.win_rate_pct}%. Paper only.`;
  }
}

export class OldRen extends ReadOnly {
  id = 'oldren';
  name = 'Old Ren';
  envPrefix = 'OLD_REN';
  defaultUrl = 'http://127.0.0.1:8100';
  access = 'read only (knowledge import + status)';
  methods: Record<string, MethodSpec> = { status: { kind: 'read', description: 'old Ren service status' } };
  async keyNumbers() {
    return null;
  }
  protected describe(_m: string, d: any) {
    return d.summary;
  }
}

export function allAdapters(mode: 'mock' | 'live', workspace: string): Adapter[] {
  return [new Builder(mode, workspace), new Storefront(mode, workspace), new Showrunner(mode, workspace), new GrowthEngine(mode, workspace), new MemeScanner(mode, workspace), new TradingOS(mode, workspace), new OldRen(mode, workspace)];
}
