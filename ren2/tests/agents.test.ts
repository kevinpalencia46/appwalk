// Agents + Ren as head: configs, jobs/scheduler, playbooks, retro, digest, and every desk's
// real job end to end against mock adapters and a scripted fake model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCore, runToEnd } from './helpers.js';
import { validateAgent } from '../src/agents/agents.js';
import { Core } from '../src/core.js';

/** Scripted model: answers by what the prompt asks for. */
function brain(core: Core, providers: any, extra: (p: string) => string | null = () => null) {
  providers.anthropic.reply = (i: any) => {
    const p: string = i.prompt;
    const x = extra(p);
    if (x !== null) return x;
    if (p.includes('"headline"') && p.includes('"items"'))
      return JSON.stringify({
        headline: 'Websites first today: build the Kamloops plumber demo; Media keeps posting.',
        items: [
          { sector: 'websites', agent: 'scout', ask: 'Sweep Kelowna for businesses with no or outdated websites', why: 'refill the list' },
          { sector: 'websites', agent: 'sites', ask: 'Build demo for c-kam-1: Sample Plumbing (plumbing, Kamloops)', why: 'top candidate. Niche: plumbing', when: 'idle' },
          { sector: 'media', agent: 'media', ask: "Make today's video batch for our niches", why: 'consistency' },
        ],
        questions: ['Which niches should Media focus on?'],
        budget: [{ agent: 'media', usd: 1.2 }, { agent: 'outreach', usd: 0.8 }],
        propose_agents: [{ id: 'seo', mission: 'SEO for Worklane', why: 'organic traffic gap' }],
      });
    if (p.includes('landing page spec')) return JSON.stringify({ name: 'sample-plumbing', title: 'Sample Plumbing', niche: 'plumbing', headline: 'Kamloops plumbing, booked online', subhead: 'Fast, local', sections: [{ heading: 'Services', body: 'Repairs' }], cta: { label: 'Book', href: '#contact' } });
    if (p.includes('Review this demo site')) return 'Good: clear headline\nChange: add hours\nAdd: tap-to-call\nVerdict suggestion: needs changes';
    if (p.includes('Turn our decisions into reusable skills'))
      return JSON.stringify({ skills: [{ id: 'web-design-general', name: 'Web design (general)', description: 'grows from reviews', projects: ['builder'], body: '- Hours visible above the fold\n- Tap-to-call button' }, { id: 'web-niche-plumbing', name: 'Plumbing sites', description: 'plumbing niche', projects: ['builder'], body: '- Emergency line first' }] });
    if (p.includes('Plan ONE video')) return JSON.stringify({ niche: 'niche-1', title: 'Fixture title', script: 'Hook. Beat 1. Beat 2. Beat 3. Follow.', thumbnail_idea: 'big text', note: 'best watch %' });
    if (p.includes('Weekly analytics review')) return "## What's working\n- niche-1 clips (MOCK)\n## What isn't\n- long videos\n## 3 changes\n1. more clips\n## Distance to monetization\n- far (MOCK)";
    if (p.includes('first email offering the demo')) return JSON.stringify({ subject: 'We built you a demo', body: 'Hi — here is a free example site: link. Kevin, Worklane' });
    if (p.includes('For EACH property')) return '## worklane\n- leak: demo form (MOCK)\n## Top 3 actions\n1. shorten demo form (sites)';
    if (p.includes('Shortlist the best 3')) return 'c-kel-1 Example Landscaping 9/10 — no site';
    return 'ok';
  };
}

test('agent configs load and validate; seven desks with jobs, access and skills', () => {
  const { core } = makeCore();
  assert.deepEqual(core.agents.list().map((a) => a.id).sort(), ['analyst', 'media', 'ops', 'outreach', 'ren', 'scout', 'sites']);
  assert.deepEqual(core.agents.errors, {});
  for (const a of core.agents.list()) for (const s of a.skills) assert.ok(core.skills.get(s), `${a.id}: skill ${s} exists`);
  assert.ok(validateAgent({ id: 'Bad Id', name: 'x', mission: 'y', jobs: [{ id: 'j', do: 'x', every: 'nope' }] }).length >= 2);
  assert.equal(core.sectors.map((s) => s.id).join(','), 'media,websites,storefronts,ops');
});

test('create + edit agent config; id change refused', () => {
  const { core } = makeCore();
  const a = core.agents.writeConfig(null, 'id: pricer\nname: Pricer\nmission: Watch prices\njobs:\n  - { id: weekly, do: Check prices, every: "0 9 * * 1" }\n');
  assert.equal(a.jobs[0].id, 'weekly');
  assert.throws(() => core.agents.writeConfig(null, 'id: pricer\nname: S\nmission: m\n'), /already exists/);
  assert.throws(() => core.agents.writeConfig('pricer', 'id: other\nname: S\nmission: m\n'), /id/);
});

test('scheduler fires each job once per matching minute; respects pause', () => {
  const { core } = makeCore();
  const mon6 = new Date(2026, 10, 30, 6, 0); // Monday 06:00
  const first = core.agents.schedule(mon6).map((t) => `${t.agent_id}:${t.job_id}`);
  assert.ok(first.includes('analyst:property-watch'));
  assert.ok(first.includes('ops:health-check'));
  assert.equal(core.agents.schedule(mon6).length, 0, 'same slot never fires twice');
  core.agents.setStatus('ops', 'paused');
  assert.ok(!core.agents.schedule(new Date(2026, 10, 30, 6, 30)).some((t) => t.agent_id === 'ops'));
  assert.ok(core.agents.schedule(new Date(2026, 10, 30, 7, 0)).some((t) => t.job_id === 'morning-plan'), 'Ren plans at 07:00');
});

test('playbook: apply new version, revert with one call', () => {
  const { core } = makeCore();
  const v1 = core.agents.playbook('analyst');
  assert.equal(core.agents.applyPlaybook('analyst', '- new practice', 'test'), 2);
  core.agents.revertPlaybook('analyst', 1);
  assert.equal(core.agents.playbook('analyst'), v1);
});

test('ops: health + adapters + queue report, no model needed', async () => {
  const { core } = makeCore();
  const t = core.agents.runJob(core.agents.get('ops')!, core.agents.get('ops')!.jobs[0], 'schedule')!;
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.match(done.result!, /Storefronts: mock/);
  await core.stop();
});

test('Ren morning plan: reads HQ, delegates to desks, moves budget, batches questions', async () => {
  const { core, providers } = makeCore();
  brain(core, providers);
  const ren = core.agents.get('ren')!;
  const t = core.agents.runJob(ren, ren.jobs.find((j) => j.id === 'morning-plan')!, 'dashboard')!;
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.match(done.result!, /Websites first today/);
  const fromRen = core.messages.outbox('ren').filter((m) => m.kind === 'request');
  assert.deepEqual(fromRen.map((m) => m.to_agent).sort(), ['media', 'scout', 'sites']);
  assert.equal(fromRen.find((m) => m.to_agent === 'sites')!.idle_only, 1, 'demo build waits for an idle system');
  assert.equal(core.agents.capFor('media'), 1.2, 'budget moved for today');
  const plan = core.db.prepare('SELECT * FROM plans ORDER BY id DESC').get() as any;
  assert.equal(plan.source, 'model');
  assert.match(plan.questions, /niches/);
  assert.ok(JSON.parse(plan.questions).some((q: any) => q.q.includes('proposes a new agent "seo"')), 'new agents are proposed, not created');
  assert.equal(core.agents.get('seo'), undefined);
  // The plan's ask reached the scout desk and became work.
  core.workLoop();
  assert.ok(core.tasks.list().some((x) => x.agent_id === 'scout' && /Kelowna/.test(x.objective)));
  await core.stop();
});

test('Ren without a model still runs a rule-based plan', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).state = 'needs_credentials';
  (providers.ollama as any).state = 'unavailable';
  const ren = core.agents.get('ren')!;
  const t = core.agents.runJob(ren, ren.jobs[0], 'dashboard')!;
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.match(done.result!, /Rule-based plan/);
  assert.ok(core.messages.outbox('ren').some((m) => m.to_agent === 'scout'));
  await core.stop();
});

test('Ren check-in: Worklane sign-ups go to Sites first (high priority, once)', async () => {
  const { core } = makeCore();
  core.messages.send({ from: 'ren', to: 'sites', kind: 'request', subject: 'Build demo for c-kam-2: Demo Dental (dental, Kamloops)' });
  core.agents.setStatus('sites', 'paused'); // keep the inbox still so we can look at the order
  const ren = core.agents.get('ren')!;
  const t = core.agents.runJob(ren, ren.jobs.find((j) => j.id === 'check-in')!, 'schedule')!;
  assert.match((await runToEnd(core, t.id)).result!, /sign-ups sent to Sites first: su-1/);
  const q = core.messages.pendingRequests('sites');
  assert.match(q[0].subject, /Worklane demo for sign-up su-1/, 'sign-up jumps the queue');
  assert.equal(q[0].priority, 1);
  const t2 = core.agents.runJob(ren, ren.jobs.find((j) => j.id === 'check-in')!, 'dashboard')!;
  assert.match((await runToEnd(core, t2.id)).result!, /No new Worklane sign-ups/);
  await core.stop();
});

test('Scout sweeps BC areas in rotation, keeps the list, tells Ren', async () => {
  const { core, providers } = makeCore();
  brain(core, providers);
  const scout = core.agents.get('scout')!;
  const t1 = core.agents.runJob(scout, scout.jobs[0], 'dashboard')!;
  const d1 = await runToEnd(core, t1.id);
  assert.equal(d1.state, 'done', d1.error || '');
  assert.match(core.tasks.steps(t1.id)[1].output!, /Swept Kamloops: 3 candidates/);
  const t2 = core.agents.runJob(scout, scout.jobs[0], 'dashboard')!;
  await runToEnd(core, t2.id);
  assert.match(core.tasks.steps(t2.id)[1].output!, /Swept Kelowna/);
  assert.ok(core.memory.search('sweep', { project: 'builder' }).length >= 2);
  assert.ok(core.messages.inbox('ren').some((m) => /Swept Kamloops/.test(m.subject)));
  await core.stop();
});

test('Websites loop: build demo → Ren reviews → Kevin decides → memory + skills + outreach', async () => {
  const { core, providers, s } = makeCore();
  brain(core, providers);
  // Candidate exists (swept), Ren asked Sites to build it.
  const scout = core.agents.get('scout')!;
  await runToEnd(core, core.agents.runJob(scout, scout.jobs[0], 'dashboard')!.id);
  core.messages.send({ from: 'ren', to: 'sites', kind: 'request', subject: 'Build demo for c-kam-1: Sample Plumbing (plumbing, Kamloops)', body: 'Niche: plumbing' });
  core.workLoop();
  const build = core.tasks.list().find((t) => t.agent_id === 'sites')!;
  assert.equal((await runToEnd(core, build.id)).state, 'done');
  assert.ok(fs.existsSync(path.join(s.workspace, 'previews')));
  // Ren picks up the review request by itself and opens a review for Kevin.
  core.workLoop();
  const rev = core.tasks.list().find((t) => t.agent_id === 'ren' && /Review demo site/.test(t.objective))!;
  assert.equal((await runToEnd(core, rev.id)).state, 'done', rev.error || '');
  const [review] = core.db.prepare("SELECT * FROM reviews WHERE status = 'pending'").all() as any[];
  assert.equal(review.candidate_id, 'c-kam-1');
  assert.equal(review.niche, 'plumbing');
  assert.match(review.ren_notes, /tap-to-call/);
  // Kevin: needs changes.
  const { resolveReview } = await import('../src/hq.js');
  resolveReview(core, review.id, { verdict: 'changes', good: 'clean header', change: 'show hours', add: 'emergency line' });
  const decision = core.memory.search('site review', { project: 'builder', kind: 'decision' })[0];
  assert.match(decision.body, /emergency line/, 'our decision is in memory');
  assert.ok(core.messages.outbox('ren').some((m) => m.to_agent === 'sites' && m.priority === 1 && /Revise demo/.test(m.subject)), 'revision goes back to Sites first');
  // Ren turns the decision into skills.
  const skillTask = core.workLoop().find((t) => t.agent_id === 'ren') ?? core.tasks.list().find((t) => t.agent_id === 'ren' && /Update web skills/.test(t.objective))!;
  assert.equal((await runToEnd(core, skillTask.id)).state, 'done', skillTask.error || '');
  assert.match(core.skills.get('web-design-general')!.body, /Tap-to-call/);
  assert.ok(core.skills.get('web-niche-plumbing'), 'a niche skill was created');
  assert.ok(fs.readFileSync(path.join(s.skillsDir, 'web-niche-plumbing.md'), 'utf8').includes('Emergency line first'));
  await core.stop();
});

test('approved review → Outreach drafts the demo email; sending asks Kevin', async () => {
  const { core, providers } = makeCore();
  brain(core, providers);
  const { openReview, resolveReview } = await import('../src/hq.js');
  const r = openReview(core, { site_id: 'sample-plumbing-9', title: 'Sample Plumbing', niche: 'plumbing', candidate_id: 'c-kam-1', preview_url: 'http://x/previews/sample-plumbing-9/', ren_notes: 'Good' });
  resolveReview(core, r.id, { verdict: 'approve', good: 'all of it' });
  const t = core.tasks.list().find((x) => x.agent_id === 'outreach')!;
  const parked = await runToEnd(core, t.id);
  assert.equal(parked.state, 'needs_decision', parked.error || '');
  const d = core.gate.open().find((x) => x.agent_id === 'outreach')!;
  assert.equal(d.gate, 'contact');
  assert.match(d.preview!, /We built you a demo/);
  await core.stop();
});

test('Media: daily batch makes video + clips + thumbnail, posting asks Kevin; weekly analytics → lesson for Ren', async () => {
  const { core, providers } = makeCore();
  brain(core, providers);
  const media = core.agents.get('media')!;
  const t = core.agents.runJob(media, media.jobs.find((j) => j.id === 'daily-batch')!, 'dashboard')!;
  const parked = await runToEnd(core, t.id);
  assert.equal(parked.state, 'needs_decision', parked.error || '');
  const steps = core.tasks.steps(t.id);
  assert.match(steps[3].output!, /queued Showrunner job/);
  assert.match(steps[4].output!, /3 clips/);
  assert.match(steps[5].output!, /thumbnail made/);
  const d = core.gate.open()[0];
  assert.equal(d.action_type, 'video:publish');
  assert.match(d.preview!, /Fixture title/);
  const a = core.agents.runJob(media, media.jobs.find((j) => j.id === 'analytics-review')!, 'dashboard')!;
  const done = await runToEnd(core, a.id);
  assert.equal(done.state, 'done', done.error || '');
  assert.ok(core.memory.search('media analytics', { project: 'media' }).length >= 1);
  assert.ok(core.messages.inbox('ren').some((m) => /Media analytics/.test(m.subject)));
  await core.stop();
});

test('Storefront Analyst watches every property and reports to Ren', async () => {
  const { core, providers } = makeCore();
  brain(core, providers);
  const an = core.agents.get('analyst')!;
  const t = core.agents.runJob(an, an.jobs.find((j) => j.id === 'property-watch')!, 'dashboard')!;
  const done = await runToEnd(core, t.id);
  assert.equal(done.state, 'done', done.error || '');
  const outs = core.tasks.steps(t.id).map((s) => s.output || '').join('\n');
  for (const p of ['Worklane', 'Book site', 'Shop']) assert.match(outs, new RegExp(`\\[MOCK\\] ${p} last 30 days`));
  assert.ok(core.messages.inbox('ren').some((m) => /Storefronts review/.test(m.subject)));
  await core.stop();
});

test('idle-only work waits until the system is quiet', () => {
  const { core } = makeCore();
  core.messages.send({ from: 'ren', to: 'sites', kind: 'request', subject: 'Build demo for c-kel-1', idleOnly: true });
  core.runner.active.set(999, new AbortController()); // something else is running
  assert.equal(core.workLoop().filter((t) => t.agent_id === 'sites').length, 0);
  core.runner.active.delete(999);
  if (core.systemIdle()) assert.equal(core.workLoop().filter((t) => t.agent_id === 'sites').length, 1);
});

test('Kevin chats with Ren; Ren delegates and the result comes back to the chat', async () => {
  const { core, providers } = makeCore();
  brain(core, providers, (p) => (p.includes('Write a short plan') ? JSON.stringify([{ tool: 'message', args: { to: 'analyst', kind: 'request', subject: 'Check the book site numbers' } }, { tool: 'think', args: { kind: 'chat', prompt: 'Tell Kevin it is delegated' } }]) : p.includes('Tell Kevin') ? "I've asked the Analyst to check the book site." : null));
  const t = core.chat('dashboard', 'Get me a read on the book site');
  assert.equal(t.agent_id, 'ren');
  assert.equal((await runToEnd(core, t.id)).state, 'done');
  core.workLoop();
  const a = core.tasks.list().find((x) => x.agent_id === 'analyst')!;
  assert.equal((await runToEnd(core, a.id)).state, 'done', a.error || '');
  assert.ok(core.chatHistory().some((m) => m.role === 'ren' && /analyst finished "Check the book site numbers"/.test(m.text)), 'result forwarded to Kevin');
  await core.stop();
});

test('weekly retro applies a playbook version; digest summarises', async () => {
  const { core, providers } = makeCore();
  (providers.anthropic as any).reply = () => '- Lead with the biggest funnel drop\nREASON: sharper focus';
  const created = core.agents.schedule(new Date(2026, 10, 30, 7, 0));
  const retro = created.find((t) => t.kind === 'retro' && t.agent_id === 'analyst')!;
  assert.equal((await runToEnd(core, retro.id)).state, 'done');
  assert.match(core.agents.playbook('analyst'), /biggest funnel drop/);
  assert.match(core.digestText(), /analyst v2: sharper focus/);
  await core.stop();
});
