// Ren 2 dashboard — vanilla JS, no build step. Every button calls a real endpoint.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ago = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const usd = (n) => `$${Number(n || 0).toFixed(Number(n) < 1 ? 3 : 2)}`;
const tag = (s, extra = '') => `<span class="tag s-${esc(s)} ${extra}">${esc(String(s).replace(/_/g, ' '))}</span>`;
const mb = (b) => `${Math.round(b / 1048576)} MB`;

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) return void (location.href = '/login');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
const post = (p, body = {}) => api(p, { method: 'POST', body });
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
async function act(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
    refresh();
  } catch (e) {
    toast(`⚠ ${e.message}`);
  }
}

// ── live state ──
let status = null;
let orbMode = 'local';
let orbBusyUntil = 0;
let lastModelAt = 0;

async function loadStatus() {
  status = await api('/api/status');
  const k = $('#kill');
  k.textContent = status.halted ? 'Resume' : 'Stop all';
  k.classList.toggle('halted', status.halted);
  const b = [];
  if (status.halted) b.push(`<div class="b">🛑 Halted — all agents and tasks are stopped. Press Resume (or /resume on Telegram).</div>`);
  if (status.budget.paused) b.push(`<div class="b">⛔ Daily budget reached (${usd(status.budget.spent)} / ${usd(status.budget.cap)}) — cloud calls paused until midnight.</div>`);
  if (!status.ownerToken) b.push(`<div class="b warn">No owner token set — anyone who can reach this port can use the dashboard. Set REN2_OWNER_TOKEN before the Pi move.</div>`);
  $('#banner').innerHTML = b.join('');
  return status;
}

$('#kill').onclick = () =>
  act(async () => {
    if (status?.halted) await post('/api/resume');
    else if (confirm('Halt ALL agents and in-flight tasks now?')) await post('/api/kill');
  });

// ── router ──
const pages = { home, work, agents, projects, memory, system };
function route() {
  const [p, arg] = (location.hash.slice(1) || 'home').split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${p}`));
  return { page: pages[p] ? p : 'home', arg };
}
let rendering = false;
let queued = false;
async function refresh() {
  if (rendering) return void (queued = true);
  rendering = true;
  try {
    await loadStatus();
    const { page, arg } = route();
    // Keep typed text and focus across live refreshes.
    const active = document.activeElement;
    const keep = active && active.id && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') ? { id: active.id, v: active.value, s: active.selectionStart } : null;
    if (keep && document.activeElement?.dataset?.sticky === '1') return;
    await pages[page](arg);
    if (keep) {
      const el = document.getElementById(keep.id);
      if (el) {
        el.value = keep.v;
        el.focus();
        try { el.setSelectionRange(keep.s, keep.s); } catch {}
      }
    }
  } catch (e) {
    view.innerHTML = `<div class="card"><h2>Error</h2><p>${esc(e.message)}</p></div>`;
  } finally {
    rendering = false;
    if (queued) {
      queued = false;
      setTimeout(refresh, 50);
    }
  }
}
window.addEventListener('hashchange', refresh);

let debounce;
function soon() {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 400);
}
function connectSSE() {
  const es = new EventSource('/api/events');
  es.onopen = () => $('#live-dot').classList.add('on');
  es.onerror = () => $('#live-dot').classList.remove('on');
  const onModel = (e, busy) => {
    const d = JSON.parse(e.data);
    orbMode = d.provider === 'claude_code' ? 'cli' : d.provider === 'ollama' ? 'local' : 'cloud';
    lastModelAt = Date.now();
    if (busy) orbBusyUntil = Date.now() + 120000;
    else orbBusyUntil = 0;
    paintOrb();
  };
  es.addEventListener('model.start', (e) => onModel(e, true));
  es.addEventListener('model', (e) => onModel(e, false));
  for (const t of ['task', 'step', 'decision.new', 'decision.resolved', 'chat', 'halted', 'budget', 'alert', 'agent', 'memory', 'playbook', 'auto', 'draft', 'failure.recurring']) es.addEventListener(t, soon);
}

// ── Home ──
function paintOrb() {
  const o = $('#orb');
  if (!o || !status) return;
  const working = status.active.length > 0 || Date.now() < orbBusyUntil;
  o.className = `orb ${status.halted ? 'halted' : ''} ${working ? 'busy' : ''} ${Date.now() - lastModelAt < 90000 ? (orbMode === 'local' ? '' : orbMode) : ''}`;
  const t = $('#orbtext');
  if (t) t.innerHTML = status.halted ? '<b>Halted</b>' : working ? `<b>Working</b> <span class="muted">· ${status.active.length} task(s)${Date.now() - lastModelAt < 90000 ? ` · ${orbMode === 'cli' ? 'Claude CLI' : orbMode === 'cloud' ? 'cloud model' : 'local model'}` : ''}</span>` : '<b>Idle</b> <span class="muted">· ready</span>';
}

function decisionHtml(d) {
  return `<div class="decision" data-id="${d.id}">
    <div class="spread"><b>#${d.id} · ${esc(d.gate)}</b>${tag(d.status)}</div>
    <div>${esc(d.summary)}</div>
    <div class="muted">${esc(d.agent_id || 'chat')} · ${esc(d.action_type)} · ${ago(d.created_at)}${d.task_id ? ` · <a href="#work/${d.task_id}">task #${d.task_id}</a>` : ''}</div>
    ${d.preview ? `<div class="pre">${esc(d.preview)}</div>` : ''}
    <div class="btns">
      <button class="primary" data-dec="approve">Approve</button>
      <button data-dec="edit">Edit</button>
      <button class="danger" data-dec="reject">Reject</button>
      <button class="ghost" data-dec="always">Always allow this</button>
    </div>
  </div>`;
}
function wireDecisions(root) {
  root.querySelectorAll('[data-dec]').forEach((b) => {
    b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id;
      const action = b.dataset.dec;
      if (action === 'edit') {
        const text = prompt('What should change?');
        if (!text) return;
        return act(() => post(`/api/decisions/${id}`, { action, text }), 'Sent back for revision');
      }
      if (action === 'always' && !confirm('Approve, and let this agent do this kind of action without asking from now on? (Revert in System → Always allow)')) return;
      act(() => post(`/api/decisions/${id}`, { action }), action === 'reject' ? 'Rejected' : 'Approved');
    };
  });
}

function taskLine(t) {
  return `<div class="item click" onclick="location.hash='work/${t.id}'">
    <div class="spread"><span><b>#${t.id}</b> ${esc(t.objective.slice(0, 110))}</span>${tag(t.state)}</div>
    <div class="muted">${esc(t.agent_id || t.source)} · ${ago(t.updated_at)}${t.cost ? ` · ${usd(t.cost)}` : ''}</div>
  </div>`;
}

async function home() {
  const [chat, decisions, tasks, alerts, budget] = await Promise.all([api('/api/chat'), api('/api/decisions?status=open'), api('/api/tasks?limit=40'), api('/api/alerts'), api('/api/budget')]);
  const current = tasks.filter((t) => ['queued', 'planning', 'running', 'verifying', 'needs_decision'].includes(t.state));
  const recent = tasks.filter((t) => ['done', 'failed'].includes(t.state)).slice(0, 8);
  const pct = Math.min(100, budget.pct);
  view.innerHTML = `<div class="cols">
    <div class="grid" style="grid-template-columns:1fr">
      <div class="card">
        <div class="orbwrap"><div id="orb" class="orb"></div></div>
        <div id="orbtext" class="orbtext"></div>
      </div>
      <div class="card"><h2>Talk to Ren</h2>
        <div class="chatlog" id="chatlog">${chat.map((m) => `<div class="msg ${m.role === 'kevin' ? 'kevin' : 'ren'}">${esc(m.text)}${m.task_id && m.role !== 'kevin' ? ` <a href="#work/${m.task_id}">#${m.task_id}</a>` : ''}</div>`).join('') || '<div class="empty">Ask anything — "summarize what\'s in memory about Storefront".</div>'}</div>
        <form class="chatform" id="chatform"><input id="chatin" placeholder="Message Ren…" autocomplete="off"><button class="primary">Send</button></form>
      </div>
      <div class="card"><h2>Current work <a href="#work">all</a></h2><div class="list">${current.map(taskLine).join('') || '<div class="empty">Nothing running.</div>'}</div></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr">
      <div class="card"><h2>Decisions <span>${decisions.length}</span></h2><div class="list" id="decs">${decisions.map(decisionHtml).join('') || '<div class="empty">Nothing waiting on you.</div>'}</div></div>
      <div class="card"><h2>Today's spend</h2>
        <div class="spread"><span class="big">${usd(budget.spent)}</span><span class="muted">of ${usd(budget.cap)}</span></div>
        <div class="meter ${pct >= 100 ? 'over' : pct >= 80 ? 'hot' : ''}"><i style="width:${pct}%"></i></div>
      </div>
      <div class="card"><h2>Alerts</h2><div class="list">${alerts.map((a) => `<div class="item spread"><span>${tag(a.level === 'error' ? 'failed' : a.level === 'warn' ? 'pending' : 'ok')} ${esc(a.message)} <span class="muted">${ago(a.created_at)}</span></span><button class="ghost" data-alert="${a.id}">Dismiss</button></div>`).join('') || '<div class="empty">No alerts.</div>'}</div></div>
      <div class="card"><h2>Recent results</h2><div class="list">${recent.map((t) => `<div class="item click" onclick="location.hash='work/${t.id}'"><div class="spread"><b>#${t.id} ${esc(t.objective.slice(0, 70))}</b>${tag(t.state)}</div><div class="muted">${esc((t.result || t.error || '').split('\n').find((l) => l.trim())?.slice(0, 160) || '')}</div></div>`).join('') || '<div class="empty">No results yet.</div>'}</div></div>
    </div>
  </div>`;
  paintOrb();
  const log = $('#chatlog');
  log.scrollTop = log.scrollHeight;
  $('#chatform').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#chatin').value.trim();
    if (!text) return;
    $('#chatin').value = '';
    act(() => post('/api/chat', { text }));
  };
  wireDecisions($('#decs'));
  view.querySelectorAll('[data-alert]').forEach((b) => (b.onclick = () => act(() => post(`/api/alerts/${b.dataset.alert}/dismiss`))));
}

// ── Work ──
let workFilter = '';
async function work(id) {
  if (id) return taskDetail(Number(id));
  const [tasks, failures] = await Promise.all([api(`/api/tasks?limit=150${workFilter ? `&state=${workFilter}` : ''}`), api('/api/failures')]);
  const states = ['', 'queued', 'running', 'needs_decision', 'done', 'failed'];
  view.innerHTML = `
    ${failures.length ? `<div class="card" style="margin-bottom:16px"><h2>Recurring failures</h2><div class="list">${failures.map((f) => `<div class="item"><div class="spread"><b>${esc(f.signature.split('|').slice(-1)[0])}</b><span class="tag s-failed">${f.count}×</span></div><div class="muted">${esc(f.last_error.slice(0, 200))}</div><div class="row" style="margin-top:8px"><button class="primary" data-retry="${f.item_task_id}">Retry</button><button data-dismiss="${f.item_task_id}">Dismiss</button><a class="btn" href="#work/${f.item_task_id}" style="display:flex;align-items:center;text-decoration:none">Diagnosis</a></div></div>`).join('')}</div></div>` : ''}
    <div class="card">
      <div class="filters">${states.map((s) => `<button class="${s === workFilter ? 'on' : ''}" data-f="${s}">${s ? s.replace('_', ' ') : 'all'}</button>`).join('')}</div>
      <form class="chatform" id="newtask" style="margin-bottom:12px"><input id="newobj" placeholder="New task objective…"><button class="primary">Queue</button></form>
      <div class="list">${tasks.map((t) => `${taskLine(t)}${t.state === 'failed' ? `<div class="row" style="padding:0 0 12px"><button data-retry="${t.id}">Retry</button><button class="ghost" data-dismiss="${t.id}">Dismiss</button></div>` : ''}`).join('') || '<div class="empty">No tasks.</div>'}</div>
    </div>`;
  view.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => ((workFilter = b.dataset.f), refresh())));
  view.querySelectorAll('[data-retry]').forEach((b) => (b.onclick = () => act(() => post(`/api/tasks/${b.dataset.retry}/retry`), 'Requeued')));
  view.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => act(() => post(`/api/tasks/${b.dataset.dismiss}/dismiss`), 'Dismissed')));
  $('#newtask').onsubmit = (e) => {
    e.preventDefault();
    const objective = $('#newobj').value.trim();
    if (objective) act(() => post('/api/tasks', { objective }), 'Queued');
  };
}

async function taskDetail(id) {
  const t = await api(`/api/tasks/${id}`);
  const open = t.decisions.filter((d) => ['pending', 'stale'].includes(d.status));
  view.innerHTML = `<div class="card">
    <div class="spread"><a href="#work">← Work</a>${tag(t.state)}</div>
    <h3 style="margin-top:12px">#${t.id} ${esc(t.objective)}</h3>
    <dl class="kv"><dt>Agent</dt><dd>${esc(t.agent_id || '—')}</dd><dt>Source</dt><dd>${esc(t.source)}</dd><dt>Project</dt><dd>${esc(t.project || '—')}</dd><dt>Cost</dt><dd>${usd(t.cost)}</dd><dt>Created</dt><dd>${new Date(t.created_at).toLocaleString()}</dd>${t.parent_id ? `<dt>From</dt><dd><a href="#work/${t.parent_id}">#${t.parent_id}</a></dd>` : ''}${t.children.length ? `<dt>Handed to</dt><dd>${t.children.map((c) => `<a href="#work/${c.id}">#${c.id} ${esc(c.agent_id || '')}</a>`).join(', ')}</dd>` : ''}</dl>
    <div class="row" style="margin-top:12px">${['failed', 'done'].includes(t.state) || t.kind === 'diagnosis' ? `<button class="primary" id="retry">Retry</button>` : ''}${t.state === 'failed' || t.kind === 'diagnosis' ? `<button class="ghost" id="dismiss">Dismiss</button>` : ''}</div>
    ${open.length ? `<h2 style="margin-top:18px">Waiting on you</h2><div class="list" id="decs">${open.map(decisionHtml).join('')}</div>` : ''}
    ${t.result ? `<h2 style="margin-top:18px">Result</h2><div class="pre">${esc(t.result)}</div>` : ''}
    ${t.error ? `<h2 style="margin-top:18px">Error</h2><div class="pre">${esc(t.error)}</div>` : ''}
    <h2 style="margin-top:18px">Plan &amp; steps</h2>
    <div class="list steps">${t.steps.map((s) => `<div class="step"><div class="spread"><b>${s.idx + 1}. ${esc(s.tool)}${s.args.action ? `.${esc(s.args.action)}` : ''}${s.args.method ? `.${esc(s.args.method)}` : ''}</b>${tag(s.status)}</div><div class="muted">${esc(s.note || '')}${s.attempts > 1 ? ` · ${s.attempts} attempts` : ''}</div>${s.output ? `<details><summary class="muted">output</summary><div class="pre">${esc(s.output)}</div></details>` : ''}</div>`).join('') || '<div class="empty">Not planned yet.</div>'}</div>
    ${t.report ? `<h2 style="margin-top:18px">Report</h2><div class="pre">${esc(t.report)}</div>` : ''}
  </div>`;
  if ($('#decs')) wireDecisions($('#decs'));
  if ($('#retry')) $('#retry').onclick = () => act(() => post(`/api/tasks/${id}/retry`), 'Requeued');
  if ($('#dismiss')) $('#dismiss').onclick = () => act(async () => (await post(`/api/tasks/${id}/dismiss`), (location.hash = 'work')), 'Dismissed');
}

// ── Agents ──
async function agents(id) {
  const list = await api('/api/agents');
  if (id === 'new') return agentForm();
  view.innerHTML = `<div class="spread" style="margin-bottom:12px"><span class="muted">${list.length} agents</span><a class="btn" href="#agents/new" style="display:flex;align-items:center;text-decoration:none">+ New agent</a></div>
  <div class="grid">${list.map((a) => {
    const s = a.state?.status || 'stopped';
    return `<div class="card" data-agent="${esc(a.id)}">
      <div class="spread"><h3>${esc(a.name)}</h3>${tag(s, 'agent')}${a.state?.schedule_paused ? tag('paused', '') + '<span class="muted">schedule</span>' : ''}</div>
      <p class="muted" style="margin:4px 0 10px">${esc(a.mission)}</p>
      <dl class="kv"><dt>Schedule</dt><dd>${esc(a.schedule || 'on demand')}${a.nextRun ? ` · next ${new Date(a.nextRun).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</dd>
      <dt>Last run</dt><dd>${ago(a.state?.last_run_at)}${a.state?.last_task_id ? ` · <a href="#work/${a.state.last_task_id}">#${a.state.last_task_id}</a>` : ''}</dd>
      <dt>7 days</dt><dd>${a.stats.done} done · ${a.stats.failed} failed · ${a.stats.approved}/${a.stats.approved + a.stats.rejected} approved</dd>
      <dt>Budget</dt><dd>${usd(a.spentToday)} of ${usd(a.daily_budget_usd)} today</dd>
      <dt>Always allow</dt><dd>${a.auto.length ? a.auto.map(esc).join(', ') : '—'}</dd></dl>
      ${a.lastResult ? `<details><summary class="muted">last result</summary><div class="pre">${esc(a.lastResult)}</div></details>` : ''}
      <details><summary class="muted">playbook</summary><div class="pre">${esc(a.playbook)}</div><button class="ghost" data-pb="${esc(a.id)}" style="margin-top:8px">Versions…</button><div data-pbv="${esc(a.id)}"></div></details>
      <div class="row" style="margin-top:12px">
        <button class="primary" data-run>Run now</button>
        ${s !== 'running' ? '<button data-act="start">Start</button>' : '<button data-act="pause">Pause</button>'}
        ${s !== 'stopped' ? '<button class="danger" data-act="stop">Stop</button>' : ''}
        <button class="ghost" data-edit>Edit config</button>
      </div>
      <div data-editor></div>
    </div>`;
  }).join('')}</div>`;
  view.querySelectorAll('[data-agent]').forEach((card) => {
    const id = card.dataset.agent;
    card.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(() => post(`/api/agents/${id}/${b.dataset.act}`), `${id}: ${b.dataset.act}`)));
    card.querySelector('[data-run]').onclick = () => act(() => post(`/api/agents/${id}/run`), `${id} queued`);
    card.querySelector('[data-edit]').onclick = async () => {
      const { yaml } = await api(`/api/agents/${id}/config`);
      const ed = card.querySelector('[data-editor]');
      ed.innerHTML = `<div class="form" style="margin-top:12px"><textarea id="cfg-${esc(id)}" data-sticky="1" style="min-height:280px;font-family:ui-monospace,monospace;font-size:13px">${esc(yaml)}</textarea><div class="row"><button class="primary" data-save>Save</button><button class="ghost" data-cancel>Cancel</button></div></div>`;
      ed.querySelector('[data-save]').onclick = () => act(() => api(`/api/agents/${id}/config`, { method: 'PUT', body: { yaml: ed.querySelector('textarea').value } }), 'Saved');
      ed.querySelector('[data-cancel]').onclick = () => (ed.innerHTML = '');
    };
    const pb = card.querySelector('[data-pb]');
    pb.onclick = async () => {
      const vs = await api(`/api/agents/${id}/playbook`);
      card.querySelector('[data-pbv]').innerHTML = `<div class="list">${vs.map((v) => `<div class="item"><div class="spread"><b>v${v.version}</b>${v.active ? tag('active', 's-ok') : `<button data-revert="${v.version}">Revert to v${v.version}</button>`}</div><div class="muted">${esc(v.reason || '')} · ${ago(v.created_at)}</div></div>`).join('')}</div>`;
      card.querySelectorAll('[data-revert]').forEach((b) => (b.onclick = () => act(() => post(`/api/agents/${id}/playbook/revert`, { version: Number(b.dataset.revert) }), `Reverted to v${b.dataset.revert}`)));
    };
  });
}

function agentForm() {
  view.innerHTML = `<div class="card" style="max-width:720px"><a href="#agents">← Agents</a><h3 style="margin-top:12px">New agent</h3>
  <form class="form" id="af">
    <label>Id (lowercase, dashes)<input name="id" required pattern="[a-z][a-z0-9-]{1,31}"></label>
    <label>Name<input name="name" required></label>
    <label>Mission<textarea name="mission" required></textarea></label>
    <label>Projects (comma separated)<input name="projects" placeholder="storefront, builder"></label>
    <label>Tools (comma separated)<input name="tools" value="memory, think, http"></label>
    <label>Schedule (cron, optional)<input name="schedule" placeholder="0 9 * * *"></label>
    <label>Daily budget (USD)<input name="daily_budget_usd" type="number" step="0.05" min="0" value="0.5"></label>
    <label>Reports to<select name="reports_to"><option value="telegram_digest">Daily digest</option><option value="telegram_now">Telegram now</option></select></label>
    <button class="primary">Create agent</button>
  </form></div>`;
  $('#af').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
    act(async () => {
      await post('/api/agents', { ...f, projects: split(f.projects), tools: split(f.tools), daily_budget_usd: Number(f.daily_budget_usd) });
      location.hash = 'agents';
    }, 'Agent created');
  };
}

// ── Projects ──
async function projects() {
  const list = await api('/api/projects');
  view.innerHTML = `<div class="grid">${list.map((p) => `<div class="card">
    <div class="spread"><h3>${esc(p.name)}</h3>${tag(p.state)}</div>
    <div class="muted">${esc(p.detail)}</div>
    <dl class="kv" style="margin-top:10px"><dt>Address</dt><dd>${esc(p.baseUrl)}</dd><dt>Access</dt><dd>${esc(p.access)}</dd><dt>Agents</dt><dd>${p.agents.map(esc).join(', ') || '—'}</dd></dl>
    <h2 style="margin-top:14px">Key numbers</h2>
    ${p.numbers?.length ? `<dl class="kv">${p.numbers.map((n) => `<dt>${esc(n.label)}</dt><dd><b>${esc(n.value)}</b></dd>`).join('')}</dl>` : '<div class="empty">No numbers — service not connected.</div>'}
    <h2 style="margin-top:14px">Knowledge</h2>
    <div class="list">${p.knowledge.map((k) => `<div class="item click" onclick="location.hash='memory/${k.id}'">${esc(k.title)} <span class="tag">${esc(k.kind)}</span></div>`).join('') || '<div class="empty">Nothing yet.</div>'}</div>
  </div>`).join('')}</div>`;
}

// ── Memory ──
let memQ = '';
let memProject = '';
let memKind = '';
async function memory(id) {
  if (id === 'new') return memoryEditor(null);
  if (id) return memoryEditor(await api(`/api/memory/${id}`));
  const [d, decisions, drafts] = await Promise.all([api(`/api/memory?q=${encodeURIComponent(memQ)}&project=${encodeURIComponent(memProject)}&kind=${encodeURIComponent(memKind)}`), api('/api/decisions'), api('/api/drafts')]);
  view.innerHTML = `<div class="cols"><div class="card">
    <form class="form" id="msearch"><div class="row" style="flex-wrap:nowrap"><input id="mq" placeholder="Search memory…" value="${esc(memQ)}"><button class="primary">Search</button></div>
    <div class="row"><select id="mp" style="flex:1"><option value="">All projects</option>${d.counts.byProject.map((p) => `<option ${p.project === memProject ? 'selected' : ''} value="${esc(p.project)}">${esc(p.project)} (${p.n})</option>`).join('')}</select>
    <select id="mk" style="flex:1"><option value="">All kinds</option>${d.kinds.map((k) => `<option ${k === memKind ? 'selected' : ''}>${k}</option>`).join('')}</select></div></form>
    <div class="spread" style="margin:12px 0"><span class="muted">${d.items.length} of ${d.counts.total} items</span><a class="btn" href="#memory/new" style="display:flex;align-items:center;text-decoration:none">+ Note</a></div>
    <div class="list">${d.items.map((i) => `<div class="item click" onclick="location.hash='memory/${i.id}'"><div class="spread"><b>${esc(i.title)}</b><span class="row"><span class="tag">${esc(i.project)}</span><span class="tag">${esc(i.kind)}</span></span></div><div class="muted">${esc(i.body.replace(/^#.*\n/, '').slice(0, 180))}</div><div class="muted" style="font-size:13px">${esc(i.source)} · ${ago(i.updated_at)}</div></div>`).join('') || '<div class="empty">Nothing matches.</div>'}</div>
  </div>
  <div class="grid" style="grid-template-columns:1fr">
    <div class="card"><h2>Recent decisions</h2><div class="list">${decisions.slice(0, 12).map((x) => `<div class="item"><div class="spread"><span>#${x.id} ${esc(x.summary.slice(0, 90))}</span>${tag(x.status)}</div><div class="muted">${esc(x.agent_id || 'chat')} · ${ago(x.resolved_at || x.created_at)}${x.response ? ` · “${esc(x.response.slice(0, 80))}”` : ''}</div></div>`).join('') || '<div class="empty">None yet.</div>'}</div></div>
    <div class="card"><h2>Drafts</h2><div class="list">${drafts.slice(0, 10).map((x) => `<div class="item"><div class="spread"><b>#${x.id} ${esc(x.platform)}</b>${tag(x.status)}</div><div class="pre">${esc(x.text)}</div></div>`).join('') || '<div class="empty">No drafts.</div>'}</div></div>
  </div></div>`;
  $('#msearch').onsubmit = (e) => {
    e.preventDefault();
    memQ = $('#mq').value;
    refresh();
  };
  $('#mp').onchange = (e) => ((memProject = e.target.value), refresh());
  $('#mk').onchange = (e) => ((memKind = e.target.value), refresh());
}

async function memoryEditor(item) {
  const meta = await api('/api/meta');
  view.innerHTML = `<div class="card" style="max-width:860px"><a href="#memory">← Memory</a>
    <form class="form" id="me" style="margin-top:12px">
      <label>Title<input name="title" id="me-title" data-sticky="1" value="${esc(item?.title || '')}" required></label>
      <div class="row"><label style="flex:1">Project<input name="project" id="me-project" data-sticky="1" value="${esc(item?.project || 'general')}"></label>
      <label style="flex:1">Kind<select name="kind">${meta.kinds.map((k) => `<option ${k === (item?.kind || 'fact') ? 'selected' : ''}>${k}</option>`).join('')}</select></label></div>
      <label>Body (markdown)<textarea name="body" id="me-body" data-sticky="1" style="min-height:320px">${esc(item?.body || '')}</textarea></label>
      <div class="muted">${item ? `${esc(item.source)}${item.path ? ` · knowledge/${esc(item.path)}` : ' · database only'} · updated ${ago(item.updated_at)}` : 'Saved as a markdown note in knowledge/'}</div>
      <button class="primary">${item ? 'Save' : 'Create note'}</button>
    </form></div>`;
  $('#me').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    act(async () => {
      if (item) await api(`/api/memory/${item.id}`, { method: 'PUT', body: f });
      else {
        const n = await post('/api/memory', f);
        location.hash = `memory/${n.id}`;
      }
    }, 'Saved');
  };
}

// ── System ──
async function system() {
  const s = await api('/api/system');
  const h = s.health;
  const meter = (pct) => `<div class="meter ${pct >= 90 ? 'over' : pct >= 75 ? 'hot' : ''}"><i style="width:${Math.min(100, pct ?? 0)}%"></i></div>`;
  view.innerHTML = `<div class="grid">
    <div class="card"><h2>Kill switch</h2><p class="muted">Halts every agent and in-flight task immediately. Tasks resume from their last completed step.</p>
      <button class="${s.halted ? 'primary' : 'kill'}" id="kill2" style="width:100%;min-height:64px;font-size:20px">${s.halted ? 'Resume everything' : 'STOP ALL'}</button></div>
    <div class="card"><h2>Machine <span>${esc(h.host)} · ${esc(h.arch)}</span></h2>
      <dl class="kv"><dt>CPU</dt><dd>${h.cpu_pct ?? '?'}% · load ${h.load1}/${h.cores}</dd></dl>${meter(h.cpu_pct)}
      <dl class="kv" style="margin-top:10px"><dt>RAM</dt><dd>${h.mem.pct}% · ${mb(h.mem.used)} / ${mb(h.mem.total)}</dd></dl>${meter(h.mem.pct)}
      <dl class="kv" style="margin-top:10px"><dt>Swap</dt><dd>${h.swap ? `${h.swap.pct}% · ${mb(h.swap.used)}` : 'none'}</dd><dt>Temp</dt><dd>${h.temp_c !== null ? `${h.temp_c}°C` : 'no sensor'}</dd><dt>Disk</dt><dd>${h.disk ? `${h.disk.pct}% · ${mb(h.disk.used)} / ${mb(h.disk.total)}` : '?'}</dd><dt>Ren 2 RSS</dt><dd>${mb(h.process_rss)} (limit 1 GB)</dd><dt>Node</dt><dd>${esc(h.node)}</dd></dl>
      ${h.warnings.length ? `<p>${h.warnings.map((w) => tag('pending') + ' ' + esc(w)).join('<br>')}</p>` : ''}</div>
    <div class="card"><h2>Budget</h2>
      <div class="spread"><span class="big">${usd(s.budget.spent)}</span><span class="muted">of ${usd(s.budget.cap)} · ${s.budget.pct}%</span></div>${meter(s.budget.pct)}
      <form class="row" id="capf" style="margin-top:12px;flex-wrap:nowrap"><input id="capin" type="number" min="0" step="0.5" value="${s.budget.cap}"><button class="primary">Set cap</button></form>
      <div class="list" style="margin-top:10px">${s.budget.perModel.map((m) => `<div class="item spread"><span>${esc(m.provider)} · ${esc(m.model)}</span><span>${usd(m.usd)} · ${m.calls}</span></div>`).join('') || '<div class="empty">No calls today.</div>'}</div></div>
    <div class="card"><h2>Models</h2><div class="list">${Object.entries(s.models.providers).map(([id, p]) => `<div class="item spread"><span><b>${esc(id)}</b> <span class="muted">${p.cloud ? 'cloud' : 'local'}${p.detail ? ' · ' + esc(p.detail) : ''}</span></span>${tag(p.status)}</div>`).join('')}</div>
      <details><summary class="muted">routes</summary><div class="pre">${esc(Object.entries(s.models.routes).map(([k, v]) => `${k}: ${v.join(' → ')}`).join('\n'))}</div></details></div>
    <div class="card"><h2>Tools</h2><div class="list">${s.tools.map((t) => `<div class="item spread"><span><b>${esc(t.name)}</b> <span class="muted">${esc(t.detail || '')}</span></span>${tag(t.status)}</div>`).join('')}</div></div>
    <div class="card"><h2>Telegram</h2><div class="spread"><span class="muted">${esc(s.telegram.detail || '')}</span>${tag(s.telegram.status)}</div>${s.telegram.lastError ? `<div class="muted">last error: ${esc(s.telegram.lastError)}</div>` : ''}
      <h2 style="margin-top:14px">Publishing</h2><div class="list">${s.publishers.map((p) => `<div class="item spread"><span><b>${esc(p.label)}</b> <span class="muted">${esc(p.detail)}</span></span>${tag(p.status)}</div>`).join('')}</div></div>
    <div class="card"><h2>Always allow</h2><div class="list">${s.auto.map((a) => `<div class="item spread"><span><b>${esc(a.agent)}</b> may <b>${esc(a.action)}</b> without asking</span><button class="danger" data-unauto="${esc(a.agent)}|${esc(a.action)}">Revert</button></div>`).join('') || '<div class="empty">Nothing yet. Press “Always allow this” on a decision to add one.</div>'}</div></div>
    <div class="card"><h2>Settings</h2><dl class="kv"><dt>Adapters</dt><dd>${tag(s.settings.adapterMode === 'mock' ? 'mock' : 'ok')} ${esc(s.settings.adapterMode)}</dd><dt>Listen</dt><dd>${esc(s.settings.host)}:${s.settings.port}</dd><dt>Owner token</dt><dd>${s.settings.ownerToken ? 'set' : tag('needs_config') + ' not set'}</dd><dt>Max tasks</dt><dd>${s.settings.maxTasks}</dd><dt>Digest</dt><dd>${esc(s.settings.digestCron)}</dd><dt>Retro</dt><dd>${esc(s.settings.retroCron)}</dd></dl>
      ${Object.keys(s.agentErrors).length ? `<h2 style="margin-top:14px">Agent config errors</h2><div class="pre">${esc(JSON.stringify(s.agentErrors, null, 1))}</div>` : ''}</div>
  </div>`;
  $('#kill2').onclick = () => $('#kill').click();
  $('#capf').onsubmit = (e) => {
    e.preventDefault();
    act(() => post('/api/budget', { cap: Number($('#capin').value) }), 'Budget cap set');
  };
  view.querySelectorAll('[data-unauto]').forEach((b) => (b.onclick = () => {
    const [agent, action] = b.dataset.unauto.split('|');
    act(() => api(`/api/auto/${encodeURIComponent(agent)}/${encodeURIComponent(action)}`, { method: 'DELETE' }), 'Reverted');
  }));
}

connectSSE();
refresh();
setInterval(() => route().page === 'home' && paintOrb(), 5000);
setInterval(soon, 30000);
