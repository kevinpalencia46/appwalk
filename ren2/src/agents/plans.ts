// Built-in, deterministic plans for each desk's real jobs. Cheap and reliable: the model
// only writes the creative/analytic parts. Anything not matched here is planned by the model
// from the agent's mission, skills, access and team (src/tasks/planner.ts).
import type { Core } from '../core.js';
import type { AgentDef } from './agents.js';
import type { TaskRow, StepPlan } from '../tasks/store.js';
import { propertyIds } from '../hq.js';
import { today } from '../env.js';

const field = (text: string, name: string): string | null => text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
const candId = (text: string) => text.match(/\b(c-[a-z]+-\d+|su-\d+)\b/)?.[1] ?? null;

export function nicheOf(text: string): string | null {
  return field(text, 'niche') || text.match(/\(([a-z][a-z &-]{2,30}), [A-Z]/)?.[1] || null;
}

export function builtinPlan(core: Core, a: AgentDef, t: TaskRow): StepPlan[] | null {
  const job = t.job_id;
  const o = t.objective;
  switch (a.id) {
    case 'ren':
      return renPlan(core, t, job, o);
    case 'media':
      if (job === 'analytics-review' || /analytics|what('|’)s working/i.test(o)) return mediaAnalytics(core);
      if (job?.startsWith('shorts') || (!job && /\b(shorts?|reels?|tiktok)\b/i.test(o) && !/long/i.test(o))) return mediaShort(core, t);
      if (job === 'long-form' || /video|batch|clip|content|post|long/i.test(o)) return mediaLong(core, t);
      return null;
    case 'analyst':
      if (job === 'property-watch' || /propert|storefront|analy[sz]e|worklane|book|shop/i.test(o)) return analystWatch(core, t);
      return null;
    case 'scout':
      if (job === 'sweep' || /sweep/i.test(o)) return scoutSweep(o);
      return null;
    case 'sites':
      if (/demo|site|landing page|revise/i.test(o)) return sitesBuild(core, t);
      return null;
    case 'outreach':
      if (/reach out to/i.test(o)) return outreachCandidate(t);
      if (/automation pro|trades/i.test(o)) return outreachTrades(t);
      return null;
    case 'ops':
      return opsCheck();
    default:
      return null;
  }
}

function opsCheck(): StepPlan[] {
  return [
    { tool: 'system', args: { action: 'health' }, note: 'Pi health' },
    { tool: 'system', args: { action: 'adapters' }, note: 'Adapter status' },
    { tool: 'system', args: { action: 'queue' }, note: 'Clear Ren 2 queue jams' },
    { tool: 'system', args: { action: 'ops_report', health: '{{step.0}}', adapters: '{{step.1}}', queue: '{{step.2}}', result: true }, note: 'Report' },
  ];
}

// ── Ren ──
const PLAN_JSON = `Return JSON only:
{"headline": "one sentence: today's focus",
 "items": [{"sector": "media|websites|storefronts|ops", "agent": "<agent id>", "ask": "concrete request, one line", "why": "short", "priority": "high|normal", "when": "now|idle"}],
 "questions": ["only real questions for Kevin, batched"],
 "budget": [{"agent": "<id>", "usd": 0.5}],
 "pause": [], "resume": [],
 "propose_agents": [{"id": "...", "mission": "...", "why": "..."}]}
Rules: 3–6 items; one job per item (to run an agent's job, name its job id in the ask); Worklane sign-ups always first; demo builds for candidates are "when": "idle"; don't re-ask for work already in a desk's inbox; budget total must stay within today's cap; only propose a new agent if a sector has a real gap.`;

function renPlan(core: Core, t: TaskRow, job: string | null, o: string): StepPlan[] | null {
  const roster = core.agents
    .list()
    .filter((x) => x.id !== 'ren')
    .map((x) => `- ${x.id} (${x.name}): ${x.mission} Jobs: ${x.jobs.map((j) => j.id).join(', ') || 'requests only'}.`)
    .join('\n');
  if (job === 'morning-plan' || job === 'weekly-strategy' || /^plan (today|the week)/i.test(o)) {
    const weekly = job === 'weekly-strategy' || /week/i.test(o);
    return [
      { tool: 'system', args: { action: 'hq_report' }, note: 'Read every sector, desk and inbox' },
      {
        tool: 'think',
        args: {
          kind: 'plan',
          optional: true,
          max_tokens: 1800,
          prompt: `You are Ren, head of Kevin's operation. ${weekly ? 'Weekly strategy: compare each sector against its goals, shift priorities and budget for the week ahead.' : "Morning plan: decide today's priorities and who does what."}\n\nYour playbook:\n{{playbook}}\n\nSkills:\n{{skills}}\n\nTeam:\n${roster}\n\nTeam notes:\n{{inbox}}\n\n{{step.0}}\n\n${PLAN_JSON}`,
        },
        note: weekly ? 'Weekly strategy' : "Write today's plan",
      },
      { tool: 'system', args: { action: 'apply_plan', text: '{{step.1}}', kind: weekly ? 'weekly' : 'daily', result: true }, note: 'Delegate to the desks' },
    ];
  }
  if (job === 'check-in') {
    return [
      { tool: 'system', args: { action: 'watch_signups' }, note: 'Worklane sign-ups → Sites first' },
      { tool: 'system', args: { action: 'queue' }, note: 'Unstick the queue' },
      { tool: 'system', args: { action: 'echo', text: '{{step.0}}\n{{step.1}}', result: true } },
    ];
  }
  if (job === 'evening-review') {
    return [
      { tool: 'system', args: { action: 'hq_report' }, note: 'Where every sector stands' },
      { tool: 'think', args: { kind: 'cheap-summarize', fallback: 'extractive', material: '{{step.0}}', prompt: `End of day. In at most 8 lines: what moved in each sector today, what's stuck, and tomorrow's first move.\n\n{{step.0}}`, result: true }, note: 'Evening review' },
      { tool: 'memory', args: { action: 'add', project: 'ren', kind: 'lesson', title: `Evening review ${today()}`, body: '{{step.1}}' }, note: 'Remember it' },
      { tool: 'message', args: { to: '*', kind: 'fyi', subject: `Ren's evening review ${today()}`, body: '{{step.1}}' }, note: 'Tell the team' },
    ];
  }
  if (/^review demo site/i.test(o)) {
    const niche = nicheOf(o);
    const nicheSkill = niche ? core.skills.text([`web-niche-${slug(niche)}`]) : '';
    return [
      { tool: 'memory', args: { action: 'search', project: 'builder', kind: 'decision', query: `site review ${niche || ''}`, limit: 6 }, note: 'Our past review decisions' },
      { tool: 'files', args: { action: 'read', path: `previews/${field(o, 'site_id') || 'missing'}/index.html`, optional: true }, note: 'Look at the page' },
      {
        tool: 'think',
        args: {
          kind: 'plan',
          prompt: `Review this demo site before Kevin sees it.\n\n${o}\n\nWeb design skills:\n{{skills}}\n${nicheSkill ? `\nNiche skill:\n${nicheSkill}\n` : ''}\nOur past decisions:\n{{step.0}}\n\nPage (if reachable):\n{{step.1}}\n\nWrite four short sections: Good:, Change:, Add:, Verdict suggestion: (ready / needs changes). Be specific to this page and niche.`,
        },
        note: "Ren's review",
      },
      { tool: 'system', args: { action: 'open_review', site_id: field(o, 'site_id') || '', title: field(o, 'title') || o.slice(0, 80), niche: niche || '', candidate_id: field(o, 'candidate_id') || '', preview_url: field(o, 'preview_url') || '', notes: '{{step.2}}', result: true }, note: 'Put it in front of Kevin' },
    ];
  }
  if (/^update web skills from review/i.test(o)) {
    const niche = nicheOf(o);
    const ids = ['web-design-general', ...(niche ? [`web-niche-${slug(niche)}`] : [])];
    return [
      { tool: 'memory', args: { action: 'search', project: 'builder', kind: 'decision', query: `site review ${niche || ''}`, limit: 10 }, note: 'All our review decisions' },
      { tool: 'skills', args: { action: 'get', ids }, note: 'Current skills' },
      {
        tool: 'think',
        args: {
          kind: 'write',
          json: true,
          prompt: `Kevin and Ren just reviewed a site. Turn our decisions into reusable skills so future sites start better.\n\nThis review:\n${o}\n\nAll review decisions so far:\n{{step.0}}\n\nCurrent skills:\n{{step.1}}\n\nReturn JSON only: {"skills": [${ids.map((id) => `{"id": "${id}", "name": "...", "description": "...", "projects": ["builder"], "body": "markdown bullet list, ≤ 25 lines, keep what still holds, add what we just decided"}`).join(', ')}]}`,
        },
        note: 'Rewrite the skills',
      },
      { tool: 'skills', args: { action: 'write_many', json: '{{step.2}}', result: true }, note: 'Save skills' },
    ];
  }
  return null; // chat + ad-hoc asks: the planner lets Ren answer or delegate
}

// ── Media (Showrunner) ──
// Cadence (Kevin, 2026-11-27): a long-form video every day or so, plus a few Shorts/Reels daily.
// long-form job: one long video for YouTube + clips cut from it for Shorts/Reels/TikTok.
// shorts jobs: native shorts made on their own, a couple of times a day.
function mediaContext(core: Core) {
  const s = core.sectors.find((x) => x.id === 'media');
  return {
    niches: s?.niches?.length ? s.niches.join(', ') : '',
    platforms: s?.channels?.length ? s.channels : ['youtube', 'instagram', 'tiktok'],
    reserve: s?.credit_reserve ?? 50,
  };
}

const nicheLine = (niches: string) => `Our niches: ${niches || 'NOT SET by Kevin yet — pick the best-performing niche from analytics and say so in "note"'}`;

function mediaLong(core: Core, t: TaskRow): StepPlan[] {
  const { niches, platforms, reserve } = mediaContext(core);
  const shortPlatforms = platforms.join(', ');
  const short = (i: number) => ({
    tool: 'adapter',
    args: { adapter: 'showrunner', method: 'make_short', from_job_id: '{{data.3.id}}', title: `{{data.2.shorts.${i}.title}}`, script: `{{data.2.shorts.${i}.script}}`, visuals: `{{data.2.shorts.${i}.visuals}}`, niche: '{{data.2.niche}}', min_credits: reserve, optional: true },
    note: `Short ${i + 1}: fresh vertical visuals, same audio + assets`,
  });
  return [
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'analytics', optional: true }, note: "What's been working" },
    { tool: 'memory', args: { action: 'search', project: 'media', query: 'what works niche format hook long-form retention', limit: 5 }, note: 'Our lessons' },
    {
      tool: 'think',
      args: {
        kind: 'write',
        json: true,
        prompt: `Task: ${t.objective}\n\n${nicheLine(niches)}\n\nPlaybook:\n{{playbook}}\n\nSkills:\n{{skills}}\n\nAnalytics:\n{{step.0}}\n\nLessons:\n{{step.1}}\n\nTeam notes:\n{{inbox}}\n\nPlan ONE long-form video for YouTube today (about 6–12 minutes), plus 2 Shorts/Reels that reuse its audio and assets but get FRESH visuals made for the vertical format (not cut-down clips). Return JSON only: {"niche": "...", "title": "...", "script": "full script: cold-open hook in the first 15s, 4–6 sections with a reason to keep watching between them, call to subscribe", "shorts": [{"title": "...", "script": "20–45s, hook in 2s, one idea", "visuals": "vertical visual direction: framing, captions, on-screen text, pacing"}, {"title": "...", "script": "...", "visuals": "..."}], "thumbnail_idea": "...", "note": "why this, based on what's working"}`,
      },
      note: "Plan today's long-form + its shorts",
    },
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'queue_job', format: 'long', script: '{{data.2.script}}', title: '{{data.2.title}}', niche: '{{data.2.niche}}' }, note: 'Make the long-form video' },
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'make_thumbnail', job_id: '{{data.3.id}}', idea: '{{data.2.thumbnail_idea}}', optional: true }, note: 'Thumbnail' },
    short(0),
    short(1),
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'publish_render', job_id: '{{data.3.id}}', format: 'long', platform: 'youtube', title: '{{data.2.title}}', preview_text: 'LONG-FORM for YouTube\nTitle: {{data.2.title}}\nNiche: {{data.2.niche}}\n\n{{data.2.script}}', result: true }, note: 'Post the long-form (asks Kevin unless always-allowed)' },
    {
      tool: 'adapter',
      args: { adapter: 'showrunner', method: 'publish_render', job_id: '{{data.5.id}}, {{data.6.id}}', format: 'short', platform: shortPlatforms, title: '{{data.2.shorts.0.title}} / {{data.2.shorts.1.title}}', preview_text: `2 SHORTS → ${shortPlatforms}\n1. {{data.2.shorts.0.title}} — {{data.5.visuals}}\n2. {{data.2.shorts.1.title}} — {{data.6.visuals}}`, optional: true },
      note: 'Post the shorts',
    },
  ];
}

function mediaShort(core: Core, t: TaskRow): StepPlan[] {
  const { niches, platforms, reserve } = mediaContext(core);
  return [
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'analytics', optional: true }, note: "What's been working" },
    { tool: 'memory', args: { action: 'search', project: 'media', query: 'what works short reel hook', limit: 5 }, note: 'Our lessons' },
    {
      tool: 'think',
      args: {
        kind: 'write',
        json: true,
        prompt: `Task: ${t.objective}\n\n${nicheLine(niches)}\nPlatforms: ${platforms.join(', ')}\n\nPlaybook:\n{{playbook}}\n\nSkills:\n{{skills}}\n\nAnalytics:\n{{step.0}}\n\nLessons:\n{{step.1}}\n\nPlan ONE short (vertical, 20–45 seconds) — a different angle from today's long-form; it may reuse today's audio and assets but gets fresh visuals made for vertical. Return JSON only: {"niche": "...", "title": "...", "script": "hook in the first 2s, one idea, loop-friendly ending", "visuals": "vertical visual direction: framing, captions, on-screen text, pacing", "note": "why this"}`,
      },
      note: 'Plan the short',
    },
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'make_short', from_job_id: 'latest_long', script: '{{data.2.script}}', title: '{{data.2.title}}', visuals: '{{data.2.visuals}}', niche: '{{data.2.niche}}', min_credits: reserve }, note: 'Make the short (fresh visuals, reuse assets)' },
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'publish_render', job_id: '{{data.3.id}}', format: 'short', platform: platforms.join(', '), title: '{{data.2.title}}', preview_text: 'SHORT → ' + platforms.join(', ') + '\nTitle: {{data.2.title}}\nVisuals: {{data.3.visuals}}\n\n{{data.2.script}}', result: true }, note: 'Post as Short/Reel/TikTok' },
  ];
}

function mediaAnalytics(core: Core): StepPlan[] {
  const s = core.sectors.find((x) => x.id === 'media');
  return [
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'channels' }, note: 'Channel totals' },
    { tool: 'adapter', args: { adapter: 'showrunner', method: 'analytics' }, note: 'Recent videos' },
    { tool: 'memory', args: { action: 'search', project: 'media', query: 'what works lessons', limit: 5 }, note: 'Last lessons' },
    {
      tool: 'think',
      args: {
        kind: 'research',
        prompt: `Weekly analytics review.\n\nChannels:\n{{step.0}}\n\nVideos:\n{{step.1}}\n\nPrevious lessons:\n{{step.2}}\n\nMonetization milestones (VERIFY current rules):\n${(s?.milestones || []).map((m) => `- ${m.text}`).join('\n')}\n\nNumbers marked MOCK are fixtures — say so. Write:\n## What's working (niche, format, platform, hook — with numbers)\n## What isn't\n## 3 changes for next week\n## Distance to monetization per platform`,
        result: true,
      },
      note: "What's working, what isn't",
    },
    { tool: 'memory', args: { action: 'add', project: 'media', kind: 'lesson', title: `Media analytics ${today()}`, body: '{{step.3}}' }, note: 'Remember' },
    { tool: 'message', args: { to: 'ren', kind: 'fyi', subject: `Media analytics ${today()}`, body: '{{step.3}}' }, note: 'Tell Ren' },
  ];
}

// ── Storefronts analyst ──
function analystWatch(core: Core, t: TaskRow): StepPlan[] {
  const props = propertyIds(core);
  const steps: StepPlan[] = [];
  for (const p of props) {
    steps.push({ tool: 'adapter', args: { adapter: 'storefront', method: 'summary', property: p, optional: true }, note: `${p} numbers` });
    steps.push({ tool: 'adapter', args: { adapter: 'storefront', method: 'pages', property: p, optional: true }, note: `${p} pages` });
  }
  const n = steps.length;
  steps.push({ tool: 'memory', args: { action: 'search', project: 'storefronts', query: 'findings conversion leak', limit: 5 }, note: 'What we found before' });
  const data = props.map((p, i) => `### ${p}\n{{step.${i * 2}}}\n\nPages:\n{{step.${i * 2 + 1}}}`).join('\n\n');
  steps.push(
    {
      tool: 'think',
      args: {
        kind: 'research',
        prompt: `${t.objective}\n\nPlaybook:\n{{playbook}}\n\nSkills:\n{{skills}}\n\n${data}\n\nPrevious findings:\n{{step.${n}}}\n\nNumbers marked MOCK are fixtures — say so. For EACH property: the biggest leak in its funnel (with numbers) and the smallest concrete fix (page + change + expected effect). Then: ## Top 3 actions across all properties, and who should do each (sites, media, analyst).`,
        result: true,
      },
      note: 'Analyse every property',
    },
    { tool: 'memory', args: { action: 'add', project: 'storefronts', kind: 'lesson', title: `Storefronts review ${today()}`, body: `{{step.${n + 1}}}` }, note: 'Remember' },
    { tool: 'message', args: { to: 'ren', kind: 'fyi', subject: `Storefronts review ${today()}`, body: `{{step.${n + 1}}}` }, note: 'Report to Ren' },
    { tool: 'message', args: { to: '*', kind: 'fyi', subject: `Storefronts findings ${today()}`, body: `{{step.${n + 1}}}` }, note: 'Share with the team' },
  );
  return steps;
}

// ── Scout ──
function scoutSweep(o: string): StepPlan[] {
  const area = o.match(/sweep\s+([A-Z][A-Za-z .'-]+?)(?:\s+for\b|$|\n)/)?.[1]?.trim();
  return [
    { tool: 'system', args: { action: 'next_area', ...(area ? { area } : {}) }, note: 'Which BC area' },
    { tool: 'adapter', args: { adapter: 'builder', method: 'sweep', area: '{{step.0}}' }, note: 'Sweep for no/outdated sites' },
    {
      tool: 'think',
      args: {
        kind: 'cheap-summarize',
        fallback: 'extractive',
        material: '{{step.1}}',
        prompt: `Candidates from a sweep of {{step.0}}:\n{{step.1}}\n\nSkills:\n{{skills}}\n\nShortlist the best 3 for a Worklane demo site. For each: id, business, niche, score, and the one reason a new site would help them most. Plain list.`,
        result: true,
      },
      note: 'Rate + shortlist',
    },
    { tool: 'memory', args: { action: 'add', project: 'builder', kind: 'fact', title: `Sweep ${today()}: {{step.0}}`, body: '{{step.1}}\n\nShortlist:\n{{step.2}}' }, note: 'Keep the list' },
    { tool: 'message', args: { to: 'ren', kind: 'fyi', subject: 'Swept {{step.0}} — shortlist ready', body: '{{step.2}}' }, note: 'Ren picks which to build' },
  ];
}

// ── Sites ──
function sitesBuild(core: Core, t: TaskRow): StepPlan[] {
  const o = t.objective;
  const niche = nicheOf(o);
  const cand = candId(o);
  const nicheSkill = niche ? core.skills.text([`web-niche-${slug(niche)}`]) : '';
  return [
    { tool: 'memory', args: { action: 'search', query: `${niche || ''} site review decision ${o.slice(0, 80)}`, limit: 6 }, note: 'Our decisions + what we know' },
    {
      tool: 'think',
      args: {
        kind: 'write',
        prompt: `Request: ${o}\n\nWhat we know / past decisions:\n{{step.0}}\n\nTeam notes:\n{{inbox}}\n\nPlaybook:\n{{playbook}}\n\nSkills:\n{{skills}}\n${nicheSkill ? `\nNiche skill:\n${nicheSkill}\n` : ''}\nWrite a landing page spec as JSON only: {"name": short-slug, "title": ..., "niche": "${niche || '...'}", "headline": ..., "subhead": ..., "sections": [{"heading": ..., "body": ...}] (3–4 sections), "cta": {"label": ..., "href": "#contact"}}. No invented testimonials, prices or stats.`,
      },
      note: 'Page spec',
    },
    { tool: 'adapter', args: { adapter: 'builder', method: 'create_site', spec: '{{step.1}}', ...(cand ? { candidate_id: cand } : {}), ...(niche ? { niche } : {}), result: true }, note: 'Build the demo' },
    { tool: 'notify', args: { text: `Demo ready: ${o.split('\n')[0].slice(0, 80)}`, link: '{{data.2.preview_url}}' }, note: 'Preview link' },
    {
      tool: 'message',
      args: {
        to: 'ren',
        kind: 'request',
        subject: 'Review demo site: {{data.2.title}}',
        body: `site_id: {{data.2.id}}\ntitle: {{data.2.title}}\npreview_url: {{data.2.preview_url}}\nniche: ${niche || ''}\ncandidate_id: ${cand || ''}`,
      },
      note: 'Hand to Ren for review with Kevin',
    },
  ];
}

// ── Outreach ──
function outreachCandidate(t: TaskRow): StepPlan[] {
  const cand = candId(t.objective) || '';
  return [
    { tool: 'adapter', args: { adapter: 'builder', method: 'candidates', optional: true }, note: 'Who they are' },
    { tool: 'memory', args: { action: 'search', query: `outreach ${cand} demo email`, limit: 5 }, note: 'What works' },
    {
      tool: 'think',
      args: {
        kind: 'write',
        json: true,
        prompt: `Task: ${t.objective}\n\nCandidate list:\n{{step.0}}\n\nPlaybook:\n{{playbook}}\n\nSkills:\n{{skills}}\n\nLessons:\n{{step.1}}\n\nWrite one short, personal first email offering the demo we built them (≤ 90 words, plain text, include the demo link, one soft ask, sign as Kevin, Worklane). Return JSON only: {"subject": "...", "body": "..."}`,
      },
      note: 'Write the email',
    },
    { tool: 'adapter', args: { adapter: 'builder', method: 'outreach_draft', candidate_id: cand, subject: '{{data.2.subject}}', body: '{{data.2.body}}' }, note: 'Save draft' },
    { tool: 'adapter', args: { adapter: 'builder', method: 'outreach_send', candidate_id: cand, preview_text: 'To: ' + cand + '\nSubject: {{data.2.subject}}\n\n{{data.2.body}}', result: true }, note: 'Send (asks Kevin)' },
  ];
}

function outreachTrades(t: TaskRow): StepPlan[] {
  return [
    { tool: 'adapter', args: { adapter: 'bge', method: 'prospects', segment: 'trades', limit: 5 }, note: 'Find prospects' },
    { tool: 'memory', args: { action: 'search', query: 'automation pro offer trades outreach', limit: 5 }, note: 'Offer + past lessons' },
    {
      tool: 'think',
      args: {
        kind: 'write',
        prompt: `Task: ${t.objective}\n\nPlaybook:\n{{playbook}}\n\nSkills:\n{{skills}}\n\nOffer/context:\n{{step.1}}\n\nProspects:\n{{step.0}}\n\nDraft one short, personal, plain-text email per prospect (≤ 90 words, one concrete reason it fits them, one soft ask, no fake claims). Return JSON only: [{"prospect_id": ..., "subject": ..., "body": ...}].`,
      },
      note: 'Draft messages',
    },
    { tool: 'adapter', args: { adapter: 'bge', method: 'create_drafts', messages: '{{step.2}}' }, note: 'Save drafts in BGE' },
    { tool: 'adapter', args: { adapter: 'bge', method: 'send_drafts', draft_ids: '{{data.3.ids}}', messages: '{{step.2}}', result: true }, note: 'Send (gated)' },
  ];
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
