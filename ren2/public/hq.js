// Home = Ren's HQ: Ren's plan and who's doing what, everything that needs Kevin in one
// list (site reviews, decisions, Ren's questions), the sector scoreboard, the team, and chat.
export function makeHome({ $, view, esc, ago, usd, tag, api, post, act, decisionHtml, wireDecisions, paintOrb }) {
  const lamp = (t) => (t.status !== 'running' ? 'off' : t.working ? 'work' : t.needsYou ? 'wait' : 'idle');
  const goalVal = (g) => {
    if (g.value === null || g.value === undefined) return '<span class="muted">n/a</span>';
    const v = `<b>${esc(g.value)}</b>${g.target !== undefined ? `<span class="muted"> / ${esc(g.target)}</span>` : ''}`;
    return `${v}${g.mock ? ' <span class="tag s-mock">MOCK</span>' : ''}${g.met === true ? ' <span class="ok">✓</span>' : g.met === false ? ' <span class="no">✗</span>' : ''}`;
  };

  function reviewHtml(r) {
    return `<div class="review" data-review="${r.id}">
      <div class="spread"><b>Site review #${r.id} · ${esc(r.title)}</b><span class="tag s-pending">review</span></div>
      <div class="muted small">${esc(r.niche || 'no niche')}${r.candidate_id ? ` · for ${esc(r.candidate_id)}` : ''} · ${ago(r.created_at)}</div>
      ${r.preview_url ? `<a class="btn openprev" href="${esc(r.preview_url)}" target="_blank" rel="noopener">Open the site ↗</a>` : ''}
      <details open><summary class="muted small">Ren's review</summary><div class="pre">${esc(r.ren_notes || '')}</div></details>
      <div class="form" style="margin-top:8px">
        <textarea data-f="good" id="rv-good-${r.id}" data-sticky="1" placeholder="What's good (keep doing this)" style="min-height:56px"></textarea>
        <textarea data-f="change" id="rv-change-${r.id}" data-sticky="1" placeholder="What needs to change" style="min-height:56px"></textarea>
        <textarea data-f="add" id="rv-add-${r.id}" data-sticky="1" placeholder="What to add or improve" style="min-height:56px"></textarea>
        <div class="btns2"><button class="primary" data-verdict="approve">Approve</button><button class="warm" data-verdict="changes">Needs changes</button></div>
        <div class="muted small">Our decisions go into memory and Ren turns them into web design skills for the next sites.</div>
      </div>
    </div>`;
  }

  return async function home() {
    const [hq, chat, budget, alerts] = await Promise.all([api('/api/hq'), api('/api/chat'), api('/api/budget'), api('/api/alerts')]);
    const plan = hq.plan;
    const qs = (plan?.questions || []).map((q, i) => ({ ...q, i })).filter((q) => !q.answer);
    const needsCount = hq.reviews.length + hq.decisions.length + qs.length;
    const pct = Math.min(100, budget.pct);
    view.innerHTML = `
    <div class="cols">
      <div class="grid" style="grid-template-columns:1fr">
        <div class="card renhead">
          <div class="renrow">
            <div class="orbwrap small-orb"><div id="orb" class="orb"></div></div>
            <div style="min-width:0">
              <div class="small muted">REN · HEAD OF OPERATIONS</div>
              <div id="orbtext"></div>
              <div class="headline">${plan ? esc(plan.headline) : 'No plan yet today. Ren plans every morning at 07:00 — or plan now.'}</div>
              <div class="muted small">${plan ? `${plan.kind} plan · ${ago(plan.created_at)}${plan.source === 'rules' ? ' · rule-based (no planning model reachable)' : ''}` : ''}${hq.adapterMode === 'mock' ? ' · numbers are MOCK — practice mode' : ''}</div>
            </div>
          </div>
          <div class="list planlist">${(plan?.items || []).map((it, n) => `<div class="item"><div class="spread"><span><b>${n + 1}.</b> ${esc(it.ask)}</span>${tag(it.status === 'unread' ? (it.when === 'idle' ? 'queued_idle' : 'queued') : it.status)}</div><div class="muted small">→ <a href="#agents/${esc(it.agent)}">${esc(it.agent)}</a> · ${esc(it.sector)}${it.priority === 'high' ? ' · <b>high priority</b>' : ''}${it.when === 'idle' ? ' · when idle' : ''}${it.why ? ` · ${esc(it.why)}` : ''}${it.task_id ? ` · <a href="#work/${it.task_id}">#${it.task_id}</a>` : ''}</div></div>`).join('') || '<div class="empty">Nothing delegated yet.</div>'}</div>
          ${plan?.notes ? `<div class="muted small" style="margin-top:6px">${esc(plan.notes)}</div>` : ''}
          <div class="row" style="margin-top:12px"><button class="primary" id="plannow">Plan now</button><button id="planweek">Plan the week</button><a class="btn" href="#agents/ren" style="display:flex;align-items:center;text-decoration:none">Ren's desk</a></div>
        </div>
        <div class="card"><h2>Talk to Ren <span class="muted small">Ren answers or hands it to the right desk</span></h2>
          <div class="chatlog" id="chatlog">${chat.map((m) => `<div class="msg ${m.role === 'kevin' ? 'kevin' : 'ren'}">${esc(m.text)}${m.task_id && m.role !== 'kevin' ? ` <a href="#work/${m.task_id}">#${m.task_id}</a>` : ''}</div>`).join('') || '<div class="empty">e.g. "Get the Refill Pack selling", "How are the channels doing?"</div>'}</div>
          <form class="chatform" id="chatform"><input id="chatin" placeholder="Message Ren…" autocomplete="off"><button class="primary">Send</button></form>
        </div>
      </div>
      <div class="grid" style="grid-template-columns:1fr">
        <div class="card"><h2>Needs you <span>${needsCount}</span></h2>
          <div class="list" id="needs">
            ${hq.reviews.map(reviewHtml).join('')}
            ${qs.map((q) => `<div class="item question"><div><span class="tag s-pending">Ren asks</span> ${esc(q.q)}</div><form class="chatform" data-q="${plan.id}:${q.i}" style="margin-top:8px"><input id="q-${plan.id}-${q.i}" placeholder="Your answer"><button>Answer</button></form></div>`).join('')}
            ${hq.decisions.map(decisionHtml).join('')}
            ${needsCount ? '' : '<div class="empty">Nothing waiting on you.</div>'}
          </div>
        </div>
        <div class="card"><h2>Team <a href="#agents">desks</a></h2>
          <div class="teamlist">${hq.team.map((t) => `<a class="tm" href="#agents/${esc(t.id)}"><span class="lamp ${lamp(t)}"></span><b>${esc(t.name)}</b><span class="muted small clip1">${t.working ? esc(t.now || 'working') : t.status !== 'running' ? t.status : t.waiting ? `${t.waiting} in inbox` : 'idle'}</span></a>`).join('')}</div>
        </div>
        <div class="card"><h2>Today's spend</h2>
          <div class="spread"><span class="big">${usd(budget.spent)}</span><span class="muted">of ${usd(budget.cap)}</span></div>
          <div class="meter ${pct >= 100 ? 'over' : pct >= 80 ? 'hot' : ''}"><i style="width:${pct}%"></i></div>
          ${alerts.length ? `<div class="list" style="margin-top:10px">${alerts.slice(0, 4).map((a) => `<div class="item spread"><span class="small">${tag(a.level === 'error' ? 'failed' : 'pending')} ${esc(a.message)}</span><button class="ghost" data-alert="${a.id}">Dismiss</button></div>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>
    <h2 class="section">Sectors</h2>
    <div class="sectors">${hq.sectors.map((s) => `<div class="card sector">
      <div class="spread"><h3>${esc(s.name)}</h3><span class="row">${s.desks.map((d) => `<a href="#agents/${esc(d.id)}" title="${esc(d.name)}" class="mini"><span class="lamp ${d.status !== 'running' ? 'off' : d.working ? 'work' : d.needsYou ? 'wait' : 'idle'}"></span>${esc(d.id)}</a>`).join('')}</span></div>
      <div class="muted small">${esc(s.why)}</div>
      ${s.id === 'media' && !s.niches?.length ? '<div class="warnline">Niches not set — add them in config/sectors.yaml (media → niches) so Media makes the right content.</div>' : ''}
      <div class="goals">${s.goals.map((g) => `<div class="goal"><span>${esc(g.text)}</span><span class="gv">${goalVal(g)}</span></div>`).join('')}</div>
      ${s.milestones?.length ? `<details><summary class="muted small">Monetization milestones</summary><ul class="small">${s.milestones.map((m) => `<li>${esc(m.text)}</li>`).join('')}</ul><div class="muted small">VERIFY against each platform's current rules.</div></details>` : ''}
      ${s.areas?.length ? `<details><summary class="muted small">BC areas in rotation</summary><div class="chips">${s.areas.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div></details>` : ''}
    </div>`).join('')}</div>
    <div class="card" style="margin-top:16px"><h2>Team channel <a href="#agents">all</a></h2><div class="list">${hq.board.map((m) => `<div class="item small"><b>${esc(m.from_agent === '*' ? 'Team' : m.from_agent)}</b> ${m.kind === 'request' ? '→' : m.kind === 'reply' ? '↩' : '•'} <b>${esc(m.to_agent === '*' ? 'Team' : m.to_agent)}</b> · ${esc(m.subject)} <span class="muted">${ago(m.created_at)}</span>${m.kind === 'request' ? ' ' + tag(m.status) : ''}</div>`).join('') || '<div class="empty">Quiet.</div>'}</div></div>`;

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
    $('#plannow').onclick = () => act(() => post('/api/hq/plan'), 'Ren is planning…');
    $('#planweek').onclick = () => act(() => post('/api/hq/plan', { weekly: true }), 'Ren is planning the week…');
    wireDecisions($('#needs'));
    view.querySelectorAll('[data-q]').forEach((f) => {
      f.onsubmit = (e) => {
        e.preventDefault();
        const [pid, i] = f.dataset.q.split(':');
        const answer = f.querySelector('input').value.trim();
        if (answer) act(() => post(`/api/hq/questions/${pid}/${i}`, { answer }), 'Ren has your answer');
      };
    });
    view.querySelectorAll('[data-review]').forEach((card) => {
      card.querySelectorAll('[data-verdict]').forEach((b) => {
        b.onclick = () => {
          const val = (f) => card.querySelector(`[data-f="${f}"]`).value.trim();
          const body = { verdict: b.dataset.verdict, good: val('good'), change: val('change'), add: val('add') };
          act(() => post(`/api/reviews/${card.dataset.review}`, body), body.verdict === 'approve' ? 'Approved — Outreach is up next' : 'Sent back to Sites with your notes');
        };
      });
    });
    view.querySelectorAll('[data-alert]').forEach((b) => (b.onclick = () => act(() => post(`/api/alerts/${b.dataset.alert}/dismiss`))));
  };
}
