// Work desks: each agent has a desk — what it's on now, its inbox, its jobs, its output,
// what it's waiting on Kevin for, its project access and skills. Plus the team channel.
export function makeDesks({ $, view, esc, ago, usd, tag, api, post, act, decisionHtml, wireDecisions }) {
  const lamp = (d) => {
    if (d.status !== 'running') return 'off';
    if (d.now) return 'work';
    if (d.waitingOnKevin.length) return 'wait';
    return 'idle';
  };
  const lampLabel = { work: 'Working', wait: 'Waiting on you', idle: 'Idle', off: 'Paused' };
  const who = (id) => (id === '*' ? 'Team' : id === 'kevin' ? 'Kevin' : id);
  const kindIcon = { request: '→', fyi: '•', reply: '↩' };
  const nextJob = (d) =>
    d.jobs
      .filter((j) => j.nextRun)
      .sort((a, b) => Date.parse(a.nextRun) - Date.parse(b.nextRun))[0];
  const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  function progress(n) {
    if (!n) return '';
    const pct = n.steps ? Math.round((n.done / n.steps) * 100) : 5;
    return `<div class="meter work"><i style="width:${Math.max(5, pct)}%"></i></div><div class="muted small">step ${Math.min(n.done + 1, n.steps || 1)}/${n.steps || '?'}${n.step ? ` · ${esc(n.step.note || n.step.tool)}` : n.state === 'planning' ? ' · planning' : ''}</div>`;
  }

  function msgLine(m, me) {
    const dir = m.from_agent === me ? `to <b>${esc(who(m.to_agent))}</b>` : `from <b>${esc(who(m.from_agent))}</b>`;
    return `<div class="item msg-line">
      <div class="spread"><span><span class="kind k-${m.kind}">${kindIcon[m.kind] || '•'} ${m.kind}</span> ${dir}</span><span class="muted small">${ago(m.created_at)}</span></div>
      <div><b>${esc(m.subject)}</b></div>
      ${m.body ? `<details><summary class="muted small">read</summary><div class="pre">${esc(m.body)}</div></details>` : ''}
      ${m.kind === 'request' ? `<div class="small">${tag(m.status)}${m.task_id ? ` <a href="#work/${m.task_id}">task #${m.task_id}</a>` : ''}</div>` : ''}
    </div>`;
  }

  function boardHtml(board) {
    return `<div class="card team"><h2>Team channel <span class="muted small">agents asking each other for work and sharing what they found</span></h2>
      <div class="board">${board
        .map(
          (m) => `<div class="post k-${m.kind}">
            <div class="route"><b>${esc(who(m.from_agent))}</b> <span class="arrow">${kindIcon[m.kind]}</span> <b>${esc(who(m.to_agent))}</b> <span class="muted small">${ago(m.created_at)}</span></div>
            <div class="subj">${esc(m.subject)}</div>
            ${m.kind === 'request' ? `<div>${tag(m.status)}${m.task_id ? ` <a class="small" href="#work/${m.task_id}">#${m.task_id}</a>` : ''}</div>` : ''}
          </div>`,
        )
        .join('') || '<div class="empty">No messages yet. When Research finishes a scan it asks Content for posts and shares findings here.</div>'}</div></div>`;
  }

  function deskCard(d) {
    const l = lamp(d);
    const nj = nextJob(d);
    const last = d.recent[0];
    return `<div class="card desk" onclick="location.hash='agents/${esc(d.id)}'">
      <div class="spread"><h3><span class="lamp ${l}"></span>${esc(d.name)}</h3><span class="tag lamp-${l}">${lampLabel[l]}</span></div>
      <div class="ondesk">
        ${d.now ? `<div class="small muted">On the desk</div><div class="clip2">${esc(d.now.objective)}</div>${progress(d.now)}`
          : `<div class="small muted">${d.status === 'running' ? 'Idle' : 'Paused'}</div><div class="muted">${nj ? `Next: ${esc(nj.id)} · ${when(nj.nextRun)}` : 'Works on requests in its inbox'}</div>`}
      </div>
      <div class="trays">
        <span class="tray ${d.counts.waiting ? 'hot' : ''}">Inbox <b>${d.counts.waiting}</b></span>
        <span class="tray ${d.waitingOnKevin.length ? 'warn' : ''}">Needs you <b>${d.waitingOnKevin.length}</b></span>
        <span class="tray">Jobs <b>${d.jobs.length}</b></span>
        <span class="tray">Today <b>${usd(d.budget.spent)}</b></span>
      </div>
      ${last ? `<div class="small muted clip1">Last: ${last.state === 'failed' ? '⚠ ' : ''}${esc(last.result.split('\n').find((x) => x.trim()) || last.objective)}</div>` : '<div class="small muted">No output yet.</div>'}
      <div class="chips">${Object.keys(d.access).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}${d.skills.map((s) => `<span class="chip skill">${esc(s.name)}</span>`).join('')}</div>
    </div>`;
  }

  async function overview() {
    const { desks, board } = await api('/api/desks');
    view.innerHTML = `<div class="spread" style="margin-bottom:12px"><span class="muted">${desks.length} desks · ${desks.filter((d) => d.now).length} working · ${desks.reduce((n, d) => n + d.counts.waiting, 0)} requests waiting</span><a class="btn" href="#agents/new" style="display:flex;align-items:center;text-decoration:none">+ New agent</a></div>
      <div class="desks">${desks.map(deskCard).join('')}</div>
      <div style="margin-top:16px">${boardHtml(board)}</div>`;
  }

  async function desk(id) {
    const [d, skills] = await Promise.all([api(`/api/desks/${encodeURIComponent(id)}`), api('/api/skills')]);
    const l = lamp(d);
    view.innerHTML = `<div class="spread" style="margin-bottom:12px"><a href="#agents">← All desks</a><span class="row">
        ${d.status !== 'running' ? '<button class="primary" data-act="start">Start</button>' : '<button data-act="pause">Pause</button>'}
        ${d.status !== 'stopped' ? '<button class="danger" data-act="stop">Stop</button>' : ''}
        <button class="ghost" id="editcfg">Edit config</button></span></div>
    <div class="card deskhead"><div class="spread"><h3 style="font-size:24px"><span class="lamp ${l}"></span>${esc(d.name)}</h3><span class="tag lamp-${l}">${lampLabel[l]}${d.schedulePaused ? ' · schedule paused' : ''}</span></div>
      <p class="muted" style="margin:6px 0 0">${esc(d.mission)}</p><div id="cfg"></div></div>
    <div class="cols" style="margin-top:16px">
      <div class="grid" style="grid-template-columns:1fr">
        <div class="card"><h2>On the desk</h2>
          ${d.now ? `<div class="item click" onclick="location.hash='work/${d.now.id}'"><b>#${d.now.id}</b> ${esc(d.now.objective)}${progress(d.now)}</div>` : `<div class="empty">${d.status === 'running' ? 'Idle — will pick up the next inbox request or scheduled job.' : 'Paused — not picking up work.'}</div>`}
          ${d.queue.length ? `<h2 style="margin-top:12px">Up next</h2><div class="list">${d.queue.map((t) => `<div class="item click" onclick="location.hash='work/${t.id}'"><div class="spread"><span>#${t.id} ${esc(t.objective.slice(0, 90))}</span>${tag(t.state)}</div></div>`).join('')}</div>` : ''}
        </div>
        ${d.waitingOnKevin.length ? `<div class="card"><h2>Needs you</h2><div class="list" id="decs">${d.waitingOnKevin.map(decisionHtml).join('')}</div></div>` : ''}
        <div class="card"><h2>Give ${esc(d.name)} work</h2>
          <form class="form" id="assign"><input id="as-subj" placeholder="What should ${esc(d.name)} do?" required><textarea id="as-body" placeholder="Details (optional)" style="min-height:70px"></textarea><button class="primary">Put it on the desk</button></form></div>
        <div class="card"><h2>Inbox <span>${d.counts.waiting ? `${d.counts.waiting} waiting` : ''}</span></h2><div class="list">${d.inbox.map((m) => msgLine(m, d.id)).join('') || '<div class="empty">Empty.</div>'}</div></div>
        <div class="card"><h2>Sent</h2><div class="list">${d.outbox.map((m) => msgLine(m, d.id)).join('') || '<div class="empty">Nothing sent yet.</div>'}</div></div>
        <div class="card"><h2>Recent output</h2><div class="list">${d.recent.map((r) => `<div class="item click" onclick="location.hash='work/${r.id}'"><div class="spread"><b>#${r.id} ${esc(r.objective.split('\n')[0].slice(0, 80))}</b>${tag(r.state)}</div><div class="muted small">${ago(r.finished_at)}${r.job_id ? ` · job ${esc(r.job_id)}` : ''}</div><div class="muted clip2">${esc(r.result)}</div></div>`).join('') || '<div class="empty">Nothing finished yet.</div>'}</div></div>
      </div>
      <div class="grid" style="grid-template-columns:1fr">
        <div class="card"><h2>Jobs</h2><div class="list">${d.jobs.map((j) => `<div class="item"><div class="spread"><b>${esc(j.id)}</b><button data-job="${esc(j.id)}">Run now</button></div><div>${esc(j.do)}</div><div class="muted small">${j.every ? `cron ${esc(j.every)}${j.nextRun ? ` · next ${when(j.nextRun)}` : ''}` : 'on demand'} · last ${ago(j.lastRunAt)}${j.lastTaskId ? ` · <a href="#work/${j.lastTaskId}">#${j.lastTaskId}</a>` : ''}</div></div>`).join('') || '<div class="empty">No jobs — works from its inbox only.</div>'}</div></div>
        <div class="card"><h2>Project access</h2><div class="list">${Object.entries(d.access).map(([p, m]) => `<div class="item"><b>${esc(p)}</b><div class="chips">${m.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>`).join('') || '<div class="empty">No project access.</div>'}</div>
          <div class="muted small" style="margin-top:8px">Tools: think, memory, message, notify${d.tools.length ? ', ' + d.tools.map(esc).join(', ') : ''}</div></div>
        <div class="card"><h2>Skills</h2><div class="list">${d.skills.map((s) => {
          const full = skills.find((x) => x.id === s.id);
          return `<div class="item"><details><summary><b>${esc(s.name)}</b> <span class="muted small">${esc(s.description)}</span></summary>${full ? `<textarea data-skill="${esc(s.id)}" id="sk-${esc(s.id)}" data-sticky="1" style="min-height:160px;margin-top:8px;font-size:14px">${esc(full.body)}</textarea><button data-saveskill="${esc(s.id)}" style="margin-top:8px">Save skill</button>` : '<div class="muted">skill file missing</div>'}</details></div>`;
        }).join('') || '<div class="empty">No skills yet.</div>'}</div></div>
        <div class="card"><h2>Playbook</h2><div class="pre">${esc(d.playbook)}</div><button class="ghost" id="pbv" style="margin-top:8px">Versions…</button><div id="pbvl"></div></div>
        <div class="card"><h2>Numbers</h2><dl class="kv"><dt>Budget</dt><dd>${usd(d.budget.spent)} of ${usd(d.budget.cap)} today</dd><dt>7 days</dt><dd>${d.stats.done} done · ${d.stats.failed} failed</dd><dt>Decisions</dt><dd>${d.stats.approved} approved · ${d.stats.rejected} rejected · ${d.stats.edited} edited</dd><dt>Always allow</dt><dd>${d.auto.length ? d.auto.map(esc).join(', ') : '—'}</dd><dt>Config</dt><dd>${esc(d.file)}</dd></dl></div>
      </div>
    </div>`;
    if ($('#decs')) wireDecisions($('#decs'));
    view.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(() => post(`/api/agents/${id}/${b.dataset.act}`), `${d.name}: ${b.dataset.act}`)));
    view.querySelectorAll('[data-job]').forEach((b) => (b.onclick = () => act(() => post(`/api/agents/${id}/jobs/${b.dataset.job}/run`), `${b.dataset.job} started`)));
    view.querySelectorAll('[data-saveskill]').forEach((b) => (b.onclick = () => act(() => api(`/api/skills/${b.dataset.saveskill}`, { method: 'PUT', body: { body: $(`#sk-${b.dataset.saveskill}`).value } }), 'Skill saved')));
    $('#assign').onsubmit = (e) => {
      e.preventDefault();
      const subject = $('#as-subj').value.trim();
      if (!subject) return;
      const body = $('#as-body').value.trim();
      $('#as-subj').value = '';
      $('#as-body').value = '';
      act(() => post(`/api/agents/${id}/assign`, { subject, body }), `On ${d.name}'s desk`);
    };
    $('#editcfg').onclick = async () => {
      const { yaml } = await api(`/api/agents/${id}/config`);
      const ed = $('#cfg');
      ed.innerHTML = `<div class="form" style="margin-top:12px"><textarea id="cfgtext" data-sticky="1" style="min-height:360px;font-family:ui-monospace,monospace;font-size:13px">${esc(yaml)}</textarea><div class="row"><button class="primary" id="cfgsave">Save</button><button class="ghost" id="cfgcancel">Cancel</button></div></div>`;
      $('#cfgsave').onclick = () => act(() => api(`/api/agents/${id}/config`, { method: 'PUT', body: { yaml: $('#cfgtext').value } }), 'Saved');
      $('#cfgcancel').onclick = () => (ed.innerHTML = '');
    };
    $('#pbv').onclick = async () => {
      const vs = await api(`/api/agents/${id}/playbook`);
      $('#pbvl').innerHTML = `<div class="list">${vs.map((v) => `<div class="item"><div class="spread"><b>v${v.version}</b>${v.active ? tag('active', 's-ok') : `<button data-revert="${v.version}">Revert to v${v.version}</button>`}</div><div class="muted small">${esc(v.reason || '')} · ${ago(v.created_at)}</div></div>`).join('')}</div>`;
      view.querySelectorAll('[data-revert]').forEach((b) => (b.onclick = () => act(() => post(`/api/agents/${id}/playbook/revert`, { version: Number(b.dataset.revert) }), `Reverted to v${b.dataset.revert}`)));
    };
  }

  async function newAgent() {
    const skills = await api('/api/skills');
    view.innerHTML = `<div class="card" style="max-width:720px"><a href="#agents">← All desks</a><h3 style="margin-top:12px">New agent</h3>
    <form class="form" id="af">
      <label>Id (lowercase, dashes)<input name="id" required pattern="[a-z][a-z0-9-]{1,31}"></label>
      <label>Name<input name="name" required></label>
      <label>Mission<textarea name="mission" required></textarea></label>
      <label>Projects it works on (comma separated)<input name="projects" placeholder="storefront, builder"></label>
      <label>Project access — read-only to start (comma separated adapters)<input name="access" placeholder="storefront, builder"></label>
      <label>Extra tools (comma separated; think/memory/message/notify are built in)<input name="tools" placeholder="http, adapter"></label>
      <label>Skills (comma separated)<input name="skills" placeholder="${esc(skills.map((s) => s.id).slice(0, 3).join(', '))}"></label>
      <label>Its job (what it works on by itself)<input name="job" placeholder="Weekly: check competitor prices and share changes"></label>
      <label>Job schedule (cron, optional)<input name="schedule" placeholder="0 9 * * 1"></label>
      <label>Daily budget (USD)<input name="daily_budget_usd" type="number" step="0.05" min="0" value="0.5"></label>
      <label>Reports to<select name="reports_to"><option value="telegram_digest">Daily digest</option><option value="telegram_now">Telegram now</option></select></label>
      <button class="primary">Create agent</button>
    </form><p class="muted small">Available skills: ${skills.map((s) => esc(s.id)).join(', ')}</p></div>`;
    $('#af').onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      act(async () => {
        const a = await post('/api/agents', { ...f, daily_budget_usd: Number(f.daily_budget_usd) });
        location.hash = `agents/${a.id}`;
      }, 'Agent created');
    };
  }

  return async function agents(id) {
    if (id === 'new') return newAgent();
    if (id) return desk(decodeURIComponent(id));
    return overview();
  };
}
