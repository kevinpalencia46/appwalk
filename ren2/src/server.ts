// One small node:http server: JSON API, SSE live stream, static dashboard, previews.
// Owner-token login when REN2_OWNER_TOKEN is set (required on the Pi; bind to Tailscale).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Core } from './core.js';
import { ROOT } from './env.js';
import { bus, log, redact } from './log.js';
import { health } from './health.js';
import { KINDS } from './memory/memory.js';
import { GATES } from './gate/gate.js';
import { scoreboard, latestPlan, openReviews, resolveReview, answerQuestion } from './hq.js';

type Req = http.IncomingMessage & { params: Record<string, string>; query: URLSearchParams; body: any };
type Handler = (req: Req, core: Core) => Promise<any> | any;

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}
const bad = (m: string) => new HttpError(400, m);
const notFound = (m = 'not found') => new HttpError(404, m);

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function routes(): [string, RegExp, Handler][] {
  const r: [string, string, Handler][] = [
    ['GET', '/api/status', (_q, c) => c.statusSummary()],

    // ── Ren HQ (Home) ──
    ['GET', '/api/hq', async (_q, c) => {
      const plan = latestPlan(c);
      const items = (plan?.items || []).map((it) => {
        const m = it.message_id ? c.messages.get(it.message_id) : undefined;
        return { ...it, status: m?.status ?? 'unknown', task_id: m?.task_id ?? null };
      });
      const ren = c.agents.get('ren') ? c.desk('ren') : null;
      return {
        plan: plan ? { ...plan, items } : null,
        sectors: await scoreboard(c),
        reviews: openReviews(c),
        decisions: c.gate.open(),
        ren: ren ? { status: ren.status, now: ren.now, jobs: ren.jobs, lastRunAt: ren.lastRunAt, waiting: ren.counts.waiting } : null,
        team: c.agents.list().filter((a) => a.id !== 'ren').map((a) => {
          const d = c.desk(a.id);
          return { id: a.id, name: a.name, status: d.status, working: Boolean(d.now), now: d.now?.objective?.split('\n')[0] ?? null, waiting: d.counts.waiting, needsYou: d.waitingOnKevin.length };
        }),
        board: c.messages.board(8),
        adapterMode: c.settings.adapterMode,
      };
    }],
    ['POST', '/api/hq/plan', (q, c) => {
      const ren = c.agents.get('ren');
      if (!ren) throw notFound('no ren agent');
      const job = ren.jobs.find((j) => j.id === (q.body?.weekly ? 'weekly-strategy' : 'morning-plan'));
      if (!job) throw notFound('no plan job in agents/ren.yaml');
      const t = c.agents.runJob(ren, job, 'dashboard');
      c.runner.tick();
      return t;
    }],
    ['POST', '/api/hq/questions/:plan/:idx', (q, c) => {
      const answer = String(q.body?.answer || '').trim();
      if (!answer) throw bad('answer required');
      return answerQuestion(c, Number(q.params.plan), Number(q.params.idx), answer);
    }],
    ['GET', '/api/reviews', (q, c) => (q.query.get('status') === 'all' ? c.db.prepare('SELECT * FROM reviews ORDER BY id DESC LIMIT 100').all() : openReviews(c))],
    ['POST', '/api/reviews/:id', (q, c) => {
      const v = q.body?.verdict;
      if (!['approve', 'changes'].includes(v)) throw bad('verdict must be approve or changes');
      return resolveReview(c, Number(q.params.id), { verdict: v, good: q.body.good, change: q.body.change, add: q.body.add });
    }],
    ['GET', '/api/chat', (_q, c) => c.chatHistory()],
    ['POST', '/api/chat', (q, c) => {
      const text = String(q.body?.text || '').trim();
      if (!text) throw bad('text required');
      return c.chat('dashboard', text);
    }],

    ['GET', '/api/tasks', (q, c) => c.tasks.list({ state: q.query.get('state') || undefined, agentId: q.query.get('agent') || undefined, archived: q.query.get('archived') === '1', limit: Number(q.query.get('limit') || 100) }).map((t) => ({ ...t, cost: c.budget.taskCost(t.id) }))],
    ['POST', '/api/tasks', (q, c) => {
      const objective = String(q.body?.objective || '').trim();
      if (!objective) throw bad('objective required');
      if (q.body.agent && !c.agents.get(q.body.agent)) throw bad(`no agent ${q.body.agent}`);
      if (q.body.plan !== undefined && (!Array.isArray(q.body.plan) || q.body.plan.some((s: any) => !c.tools.get(s?.tool)))) throw bad('plan must be an array of {tool, args} with known tools');
      const t = c.tasks.create({ objective, agentId: q.body.agent || null, project: q.body.project || null, source: 'dashboard', kind: q.body.agent ? 'agent' : 'request', plan: q.body.plan });
      c.runner.tick();
      return t;
    }],
    ['GET', '/api/tasks/:id', (q, c) => {
      const t = c.tasks.get(Number(q.params.id));
      if (!t) throw notFound();
      return { ...t, plan: t.plan ? JSON.parse(t.plan) : null, steps: c.tasks.steps(t.id).map((s) => ({ ...s, args: JSON.parse(s.args), data: s.data ? JSON.parse(s.data) : null })), cost: c.budget.taskCost(t.id), decisions: c.db.prepare('SELECT * FROM decisions WHERE task_id = ? ORDER BY id').all(t.id), children: c.db.prepare('SELECT id, objective, state, agent_id FROM tasks WHERE parent_id = ?').all(t.id) };
    }],
    ['POST', '/api/tasks/:id/retry', (q, c) => {
      const t = c.tasks.get(Number(q.params.id));
      if (!t) throw notFound();
      if (!['failed', 'done'].includes(t.state) && t.kind !== 'diagnosis') throw bad(`task is ${t.state}`);
      return c.runner.retry(t.id);
    }],
    ['POST', '/api/tasks/:id/dismiss', (q, c) => {
      const t = c.tasks.get(Number(q.params.id));
      if (!t) throw notFound();
      c.tasks.dismiss(t.id);
      return { ok: true };
    }],
    ['GET', '/api/failures', (_q, c) => c.runner.failures.recurring()],

    ['GET', '/api/decisions', (q, c) => (q.query.get('status') === 'open' ? c.gate.open() : c.gate.list(q.query.get('status') || undefined))],
    ['POST', '/api/decisions/:id', (q, c) => {
      const action = q.body?.action;
      if (!['approve', 'reject', 'edit', 'always'].includes(action)) throw bad('action must be approve|reject|edit|always');
      return c.decide(Number(q.params.id), action, q.body.text, 'dashboard');
    }],

    ['POST', '/api/kill', (_q, c) => (c.runner.kill('dashboard'), c.statusSummary())],
    ['POST', '/api/resume', (_q, c) => (c.runner.resume('dashboard'), c.statusSummary())],

    ['GET', '/api/budget', (_q, c) => c.budget.summary()],
    ['POST', '/api/budget', (q, c) => {
      const v = Number(q.body?.cap);
      if (!(v >= 0)) throw bad('cap must be a number ≥ 0');
      c.budget.setCap(v, Boolean(q.body.today_only));
      return c.budget.summary();
    }],

    ['GET', '/api/system', async (_q, c) => ({
      health: health(c.settings.dataDir),
      models: await c.router.status(),
      tools: await c.tools.statusAll(c),
      telegram: c.telegram.status(),
      budget: c.budget.summary(),
      auto: c.agents.autoList(),
      publishers: Object.values(c.publishers).map((p) => ({ platform: p.platform, label: p.label, ...p.status() })),
      halted: c.runner.halted(),
      settings: { adapterMode: c.settings.adapterMode, host: c.settings.host, port: c.settings.port, ownerToken: Boolean(c.settings.ownerToken), maxTasks: c.settings.maxConcurrentTasks, digestCron: c.settings.digestCron, retroCron: c.settings.retroCron },
      agentErrors: c.agents.errors,
    })],
    ['DELETE', '/api/auto/:agent/:action', (q, c) => (c.agents.removeAuto(q.params.agent, decodeURIComponent(q.params.action)), c.agents.autoList())],

    ['GET', '/api/agents', (_q, c) => c.agents.list().map((a) => {
      const st = c.agents.state(a.id);
      const last = st?.last_task_id ? c.tasks.get(st.last_task_id) : undefined;
      return { ...a, file: path.relative(ROOT, a.file), state: st, spentToday: c.budget.spent(a.id), lastResult: last?.result?.slice(0, 400) ?? null, playbook: c.agents.playbook(a.id), nextRun: a.schedule ? c.nextRun(a.schedule)?.toISOString() ?? null : null, stats: c.agentStats(a.id, 7) };
    })],
    ['POST', '/api/agents', (q, c) => {
      const b = q.body || {};
      if (typeof b.yaml === 'string') return c.agents.writeConfig(null, b.yaml);
      const list = (v: any) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x: any) => String(x).trim()).filter(Boolean);
      const access = list(b.access).map((p: string) => `  ${p}: [read]`);
      const yaml = [
        `id: ${b.id}`,
        `name: ${JSON.stringify(b.name || '')}`,
        `mission: ${JSON.stringify(b.mission || '')}`,
        `projects: [${list(b.projects).join(', ')}]`,
        `tools: [${list(b.tools).join(', ')}]`,
        access.length ? `access:\n${access.join('\n')}` : 'access: {}',
        `skills: [${list(b.skills).join(', ')}]`,
        `models: { plan: claude, work: deepseek, summarize: ollama }`,
        b.job ? `jobs:\n  - id: main\n    do: ${JSON.stringify(String(b.job))}${b.schedule ? `\n    every: "${b.schedule}"` : ''}` : 'jobs: []',
        `daily_budget_usd: ${Number(b.daily_budget_usd ?? 0.5)}`,
        `reports_to: ${b.reports_to || 'telegram_digest'}`,
        `auto: []`,
      ].join('\n');
      return c.agents.writeConfig(null, yaml);
    }],
    ['GET', '/api/agents/:id/config', (q, c) => ({ yaml: c.agents.rawConfig(q.params.id) })],
    ['PUT', '/api/agents/:id/config', (q, c) => c.agents.writeConfig(q.params.id, String(q.body?.yaml || ''))],
    ['GET', '/api/desks', (_q, c) => ({ desks: c.agents.list().map((a) => c.desk(a.id)), board: c.messages.board(30) })],
    ['GET', '/api/desks/:id', (q, c) => {
      if (!c.agents.get(q.params.id)) throw notFound(`no agent ${q.params.id}`);
      return c.desk(q.params.id);
    }],
    ['POST', '/api/agents/:id/assign', (q, c) => {
      const subject = String(q.body?.subject || '').trim();
      if (!subject) throw bad('subject required');
      if (!c.agents.get(q.params.id)) throw notFound(`no agent ${q.params.id}`);
      return c.assign(q.params.id, subject, String(q.body?.body || ''));
    }],
    ['POST', '/api/agents/:id/jobs/:job/run', (q, c) => {
      const a = c.agents.get(q.params.id);
      const j = a?.jobs.find((x) => x.id === q.params.job);
      if (!a || !j) throw notFound('no such agent/job');
      const t = c.agents.runJob(a, j, 'dashboard');
      c.runner.tick();
      return t;
    }],
    ['POST', '/api/agents/:id/inbox/read', (q, c) => (c.messages.markRead(q.params.id), c.messages.counts(q.params.id))],
    ['GET', '/api/messages', (q, c) => (q.query.get('agent') ? c.messages.inbox(q.query.get('agent')!, 50) : c.messages.board(Number(q.query.get('limit') || 50)))],
    ['GET', '/api/skills', (_q, c) => c.skills.list().map((s) => ({ ...s, file: path.relative(ROOT, s.file), agents: c.agents.list().filter((a) => a.skills.includes(s.id)).map((a) => a.id) }))],
    ['GET', '/api/skills/:id', (q, c) => c.skills.get(q.params.id) ?? (() => { throw notFound(); })()],
    ['PUT', '/api/skills/:id', (q, c) => {
      const body = String(q.body?.body || '');
      if (!body.trim()) throw bad('body required');
      return c.skills.save(q.params.id, body);
    }],
    ['POST', '/api/agents/:id/:action', (q, c) => {
      const id = q.params.id;
      if (!c.agents.get(id)) throw notFound(`no agent ${id}`);
      const a = q.params.action;
      if (a === 'start') c.agents.setStatus(id, 'running');
      else if (a === 'pause') c.agents.setStatus(id, 'paused');
      else if (a === 'stop') {
        c.agents.setStatus(id, 'stopped');
        for (const [tid, ac] of c.runner.active) if (c.tasks.get(tid)?.agent_id === id) ac.abort(new Error('agent stopped'));
      } else if (a === 'run' && !q.body?.objective && c.agents.get(id)!.jobs.length) {
        const def = c.agents.get(id)!;
        const t = c.agents.runJob(def, def.jobs[0], 'dashboard');
        c.runner.tick();
        return t;
      } else if (a === 'run') {
        const def = c.agents.get(id)!;
        const t = c.tasks.create({ objective: String(q.body?.objective || def.default_objective || `Run: ${def.mission}`), agentId: id, project: def.projects[0] ?? null, source: q.body?.objective ? 'dashboard' : 'schedule', kind: 'agent' });
        c.runner.tick();
        return t;
      } else throw notFound();
      return { id, state: c.agents.state(id) };
    }],
    ['GET', '/api/agents/:id/playbook', (q, c) => c.agents.playbookVersions(q.params.id)],
    ['POST', '/api/agents/:id/playbook/revert', (q, c) => (c.agents.revertPlaybook(q.params.id, Number(q.body?.version)), c.agents.playbookVersions(q.params.id))],

    ['GET', '/api/projects', async (_q, c) => {
      const st = await c.adapters.statusAll();
      const out = [];
      for (const a of st) {
        const ad = c.adapters.get(a.id)!;
        out.push({ ...a, numbers: await ad.keyNumbers().catch(() => null), agents: c.agents.list().filter((g) => g.projects.includes(a.id) || (a.id === 'bge' && g.projects.includes('growth-engine'))).map((g) => g.id), knowledge: c.memory.list({ project: a.id, limit: 5 }).map((k) => ({ id: k.id, title: k.title, kind: k.kind })) });
      }
      return out;
    }],

    ['GET', '/api/memory', (q, c) => ({ items: c.memory.search(q.query.get('q') || '', { project: q.query.get('project') || undefined, kind: q.query.get('kind') || undefined, limit: Number(q.query.get('limit') || 50) }), counts: c.memory.counts(), kinds: KINDS })],
    ['POST', '/api/memory', (q, c) => {
      const b = q.body || {};
      if (!b.title || !b.body) throw bad('title and body required');
      return c.memory.createNote({ project: String(b.project || 'general').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'general', kind: KINDS.includes(b.kind) ? b.kind : 'fact', title: String(b.title), body: String(b.body) });
    }],
    ['GET', '/api/memory/:id', (q, c) => c.memory.get(Number(q.params.id)) ?? (() => { throw notFound(); })()],
    ['PUT', '/api/memory/:id', (q, c) => {
      const b = q.body || {};
      if (b.kind && !KINDS.includes(b.kind)) throw bad('bad kind');
      return c.memory.update(Number(q.params.id), { title: b.title, body: b.body, project: b.project, kind: b.kind });
    }],
    ['POST', '/api/memory/reindex', (_q, c) => c.memory.indexNotes()],
    ['GET', '/api/drafts', (_q, c) => c.drafts.list()],

    ['GET', '/api/alerts', (_q, c) => c.alerts()],
    ['POST', '/api/alerts/:id/dismiss', (q, c) => (c.db.prepare('UPDATE alerts SET dismissed = 1 WHERE id = ?').run(Number(q.params.id)), { ok: true })],
    ['GET', '/api/meta', () => ({ gates: GATES, kinds: KINDS })],
  ];
  // Order matters: literal paths before params.
  return r.map(([m, p, h]) => [m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), h]);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1_000_000) reject(new HttpError(413, 'body too large'));
    });
    req.on('end', () => {
      if (!s) return resolve({});
      try {
        resolve(JSON.parse(s));
      } catch {
        reject(bad('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function cookie(req: http.IncomingMessage, name: string): string | undefined {
  return (req.headers.cookie || '').split(/;\s*/).map((p) => p.split('=')).find(([k]) => k === name)?.[1];
}
function safeEq(a: string, b: string): boolean {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
function authed(req: http.IncomingMessage, token: string): boolean {
  if (!token) return true;
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const c = decodeURIComponent(cookie(req, 'ren2_token') || '');
  return (bearer && safeEq(bearer, token)) || (c !== '' && safeEq(c, token));
}

const LOGIN = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ren 2 login</title><style>body{background:#15171a;color:#e6e8eb;font:18px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}form{display:grid;gap:14px;width:min(360px,90vw)}input,button{font:inherit;padding:16px;border-radius:12px;border:1px solid #2c3036;background:#1e2126;color:inherit}button{background:#6FE3C4;color:#0d1f1a;border:0;font-weight:600}</style></head><body><form method="post" action="/login"><h1>Ren 2</h1><input name="token" type="password" placeholder="Owner token" autofocus autocomplete="current-password"><button>Sign in</button></form></body></html>`;

export function createServer(core: Core): http.Server {
  const table = routes();
  const pub = path.join(ROOT, 'public');
  return http.createServer(async (req0, res) => {
    const req = req0 as Req;
    const url = new URL(req.url || '/', 'http://x');
    const send = (status: number, body: any, headers: Record<string, string> = {}) => {
      const isStr = typeof body === 'string' || Buffer.isBuffer(body);
      res.writeHead(status, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
      res.end(isStr ? body : redact(JSON.stringify(body)));
    };
    try {
      if (url.pathname === '/healthz') return send(200, { ok: true, halted: core.runner.halted() });
      if (url.pathname === '/login') {
        if (req.method === 'POST') {
          let raw = '';
          for await (const ch of req) raw += ch;
          const token = new URLSearchParams(raw).get('token') || '';
          if (core.settings.ownerToken && safeEq(token, core.settings.ownerToken)) {
            res.writeHead(302, { location: '/', 'set-cookie': `ren2_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 90}` });
            return res.end();
          }
          return send(401, LOGIN.replace('Owner token"', 'Wrong token — try again"'), { 'content-type': 'text/html; charset=utf-8' });
        }
        return send(200, LOGIN, { 'content-type': 'text/html; charset=utf-8' });
      }
      if (!authed(req, core.settings.ownerToken)) {
        if (url.pathname.startsWith('/api/')) return send(401, { error: 'owner token required' });
        res.writeHead(302, { location: '/login' });
        return res.end();
      }

      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`retry: 3000\n\n`);
        const onEv = (e: any) => res.write(`event: ${e.type}\ndata: ${redact(JSON.stringify(e.data ?? {}))}\n\n`);
        bus.on('event', onEv);
        const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
        req.on('close', () => (bus.off('event', onEv), clearInterval(ping)));
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        for (const [m, re, h] of table) {
          if (m !== req.method) continue;
          const mm = url.pathname.match(re);
          if (!mm) continue;
          req.params = (mm.groups || {}) as Record<string, string>;
          req.query = url.searchParams;
          req.body = ['POST', 'PUT', 'DELETE'].includes(req.method || '') ? await readBody(req) : {};
          return send(200, (await h(req, core)) ?? { ok: true });
        }
        return send(404, { error: 'no such endpoint' });
      }

      // static: previews (mock Builder output) and the dashboard
      let base = pub;
      let rel = url.pathname;
      if (rel.startsWith('/previews/')) {
        base = path.join(core.settings.workspace, 'previews');
        rel = rel.slice('/previews'.length);
      }
      let file = path.join(base, path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(base)) return send(403, 'forbidden');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) {
        if (base !== pub) return send(404, 'not found');
        file = path.join(pub, 'index.html');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e: any) {
      // Plain Errors are expected, user-level failures (validation, "already resolved"…) → 400.
      const status = e instanceof HttpError ? e.status : e?.constructor === Error ? 400 : 500;
      if (status === 500) log('error', `${req.method} ${url.pathname}`, String(e?.stack || e));
      if (!res.headersSent) send(status, { error: redact(String(e?.message || e)) });
      else res.end();
    }
  });
}
