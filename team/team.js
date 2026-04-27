/* Hanning 2026 — Team dashboard
 * Fetches volunteers + yard signs, renders rows, supports filters,
 * inline status updates via /update-status. Mobile-first.
 */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STATE = {
    volunteers: [],
    yardSigns: [],
    activeTab: 'volunteers',
    filters: { vol: { search: '', status: '', interest: '' }, yard: { search: '', status: '' } },
    open: null, // { table, row }
  };

  const INTEREST_LABELS = {
    yard_sign: 'Yard sign',
    phone_bank: 'Phone bank',
    canvass: 'Canvass',
    event: 'Event help',
    donate: 'Donate',
    endorse: 'Endorse',
  };
  const INTEREST_CHIP = {
    yard_sign: 'chip-yard',
    phone_bank: 'chip-phone',
    canvass: 'chip-canvass',
    event: 'chip-yard',
    donate: 'chip-donate',
    endorse: 'chip-yard',
  };
  const VOLUNTEER_STATUSES = ['new','contacted','assigned','onboarded','done','bad'];
  const YARD_STATUSES = ['requested','out_for_delivery','delivered','declined','bad'];
  const STATUS_LABEL = {
    new: 'New', contacted: 'Contacted', assigned: 'Assigned', onboarded: 'Onboarded', done: 'Done', bad: 'Bad',
    requested: 'Requested', out_for_delivery: 'Out for delivery', delivered: 'Delivered', declined: 'Declined',
  };

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  function fmtTime(iso) {
    if (!iso) return '—';
    const t = new Date(iso);
    const now = new Date();
    const diffMs = now - t;
    const dayMs = 24*60*60*1000;
    if (diffMs < 60*1000) return 'just now';
    if (diffMs < 60*60*1000) return `${Math.floor(diffMs/60000)}m ago`;
    if (diffMs < dayMs) return `${Math.floor(diffMs/3600000)}h ago`;
    if (diffMs < 7*dayMs) return `${Math.floor(diffMs/dayMs)}d ago`;
    return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function isFresh(iso) { return iso && (Date.now() - new Date(iso)) < 24*60*60*1000; }

  // ---- Initials chip ----
  function getMyInitials() { return localStorage.getItem('hanning_team_initials') || ''; }
  function setMyInitials(v) { localStorage.setItem('hanning_team_initials', v); renderWho(); }
  function renderWho() {
    const el = $('#who-label');
    const v = getMyInitials();
    el.textContent = v ? `You · ${v}` : 'Set your initials';
  }
  $('#who-label').addEventListener('click', () => {
    const cur = getMyInitials();
    const v = prompt('Your initials (for tracking who updates rows):', cur || '');
    if (v !== null) setMyInitials(v.trim().slice(0, 12));
  });

  // ---- Auth check + initial fetch ----
  async function fetchAll() {
    try {
      const res = await fetch('/.netlify/functions/team-data', { credentials: 'include', cache: 'no-store' });
      if (res.status === 401) { window.location.href = '/team/'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      STATE.volunteers = data.volunteers || [];
      STATE.yardSigns = data.yard_signs || [];
      renderAll();
    } catch (err) {
      toast('Could not load data — try refresh', true);
      console.error(err);
    }
  }

  // ---- Logout ----
  $('#logout-btn').addEventListener('click', async () => {
    await fetch('/.netlify/functions/team-logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/team/';
  });
  $('#refresh-btn').addEventListener('click', () => fetchAll());

  // ---- Tabs ----
  $$('.tab').forEach(btn => btn.addEventListener('click', () => {
    const which = btn.dataset.tab;
    STATE.activeTab = which;
    $$('.tab').forEach(b => { b.classList.toggle('is-active', b.dataset.tab === which); b.setAttribute('aria-selected', b.dataset.tab === which); });
    $$('.tab-panel').forEach(p => p.hidden = (p.id !== `tab-${which}`));
  }));

  // ---- Filters ----
  ['vol-search','vol-status','vol-interest'].forEach(id => {
    $('#' + id).addEventListener('input', (e) => {
      const key = id === 'vol-search' ? 'search' : id === 'vol-status' ? 'status' : 'interest';
      STATE.filters.vol[key] = e.target.value;
      renderVolunteers();
    });
  });
  ['yard-search','yard-status'].forEach(id => {
    $('#' + id).addEventListener('input', (e) => {
      const key = id === 'yard-search' ? 'search' : 'status';
      STATE.filters.yard[key] = e.target.value;
      renderYardSigns();
    });
  });

  // ---- Volunteers list ----
  function filteredVolunteers() {
    const { search, status, interest } = STATE.filters.vol;
    const q = search.trim().toLowerCase();
    return STATE.volunteers.filter(v => {
      if (status && v.status !== status) return false;
      if (interest && !(v.interests || []).includes(interest)) return false;
      if (q) {
        const hay = `${v.first_name} ${v.last_name} ${v.email} ${v.zip || ''} ${v.note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function renderVolunteers() {
    const list = filteredVolunteers();
    $('#tab-count-vol').textContent = list.length;
    const el = $('#vol-list');
    if (!list.length) { el.innerHTML = '<div class="empty">No volunteers match your filters.</div>'; return; }
    el.innerHTML = list.map(v => {
      const interests = (v.interests || []).map(i => `<span class="chip ${INTEREST_CHIP[i] || ''}">${escapeHtml(INTEREST_LABELS[i] || i)}</span>`).join('');
      const status = v.status || 'new';
      return `
        <article class="row" data-table="hanning_volunteers" data-id="${escapeHtml(v.id)}" tabindex="0">
          <div class="row-name">${escapeHtml(v.first_name)} ${escapeHtml(v.last_name)}<small>${escapeHtml(v.email)}${v.zip ? ' · ZIP ' + escapeHtml(v.zip) : ''}</small></div>
          <div class="row-meta">${v.phone ? `<a href="tel:${escapeHtml(v.phone)}" onclick="event.stopPropagation()">${escapeHtml(v.phone)}</a>` : '<span style="opacity:.4">no phone</span>'}${v.note ? ` · <em style="opacity:.7">${escapeHtml((v.note||'').slice(0,80))}${(v.note||'').length>80?'…':''}</em>` : ''}</div>
          <div class="row-interests">${interests || '<span style="opacity:.4">—</span>'}</div>
          <span class="status-pill status-${status}">${escapeHtml(STATUS_LABEL[status] || status)}</span>
          <span class="row-time ${isFresh(v.created_at) ? 'is-fresh' : ''}">${fmtTime(v.created_at)}</span>
        </article>`;
    }).join('');

    $$('#vol-list .row').forEach(r => r.addEventListener('click', () => openDrawer('hanning_volunteers', r.dataset.id)));
  }

  // ---- Yard signs list ----
  function filteredYardSigns() {
    const { search, status } = STATE.filters.yard;
    const q = search.trim().toLowerCase();
    return STATE.yardSigns.filter(y => {
      if (status && y.status !== status) return false;
      if (q) {
        const hay = `${y.name} ${y.phone} ${y.email || ''} ${y.address} ${y.city} ${y.zip}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function renderYardSigns() {
    const list = filteredYardSigns();
    $('#tab-count-yard').textContent = list.length;
    const el = $('#yard-list');
    if (!list.length) { el.innerHTML = '<div class="empty">No yard sign requests match your filters.</div>'; return; }
    el.innerHTML = list.map(y => {
      const status = y.status || 'requested';
      const fullAddr = `${y.address}, ${y.city} ${y.zip}`;
      const mapsHref = `https://maps.apple.com/?q=${encodeURIComponent(fullAddr)}`;
      return `
        <article class="row" data-table="hanning_yard_signs" data-id="${escapeHtml(y.id)}" tabindex="0">
          <div class="row-name">${escapeHtml(y.name)}<small>${escapeHtml(fullAddr)}</small></div>
          <div class="row-meta"><a href="tel:${escapeHtml(y.phone)}" onclick="event.stopPropagation()">${escapeHtml(y.phone)}</a> · <a href="${mapsHref}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Maps ↗</a>${y.note ? ` · <em style="opacity:.7">${escapeHtml((y.note||'').slice(0,60))}${(y.note||'').length>60?'…':''}</em>` : ''}</div>
          <div class="row-interests"></div>
          <span class="status-pill status-${status}">${escapeHtml(STATUS_LABEL[status] || status)}</span>
          <span class="row-time ${isFresh(y.created_at) ? 'is-fresh' : ''}">${fmtTime(y.created_at)}</span>
        </article>`;
    }).join('');

    $$('#yard-list .row').forEach(r => r.addEventListener('click', () => openDrawer('hanning_yard_signs', r.dataset.id)));
  }

  // ---- Top stats ----
  function renderStats() {
    $('#stat-vol-total').textContent = STATE.volunteers.length;
    $('#stat-vol-new').textContent = STATE.volunteers.filter(v => (v.status || 'new') === 'new').length;
    $('#stat-yard-total').textContent = STATE.yardSigns.length;
    $('#stat-yard-pending').textContent = STATE.yardSigns.filter(y => (y.status || 'requested') !== 'delivered' && y.status !== 'declined' && y.status !== 'bad').length;
  }

  function renderAll() { renderStats(); renderVolunteers(); renderYardSigns(); }

  // ---- Drawer (detail panel) ----
  const drawer = $('#drawer');
  function openDrawer(table, id) {
    const row = (table === 'hanning_volunteers' ? STATE.volunteers : STATE.yardSigns).find(r => String(r.id) === String(id));
    if (!row) return;
    STATE.open = { table, row };
    renderDrawer();
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    STATE.open = null;
  }
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDrawer();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.getAttribute('aria-hidden') === 'false') closeDrawer(); });

  function renderDrawer() {
    const { table, row } = STATE.open;
    const isVol = table === 'hanning_volunteers';
    const statuses = isVol ? VOLUNTEER_STATUSES : YARD_STATUSES;
    const status = row.status || (isVol ? 'new' : 'requested');
    const fullName = isVol ? `${row.first_name} ${row.last_name}` : row.name;

    $('#drawer-eyebrow').textContent = isVol ? 'VOLUNTEER' : 'YARD SIGN REQUEST';
    $('#drawer-title').textContent = fullName;

    let detailRows = '';
    if (isVol) {
      const interests = (row.interests || []).map(i => INTEREST_LABELS[i] || i).join(', ') || '—';
      detailRows = `
        <dt>Email</dt><dd><a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a></dd>
        <dt>Phone</dt><dd>${row.phone ? `<a href="tel:${escapeHtml(row.phone)}">${escapeHtml(row.phone)}</a>` : '—'}</dd>
        <dt>ZIP</dt><dd>${escapeHtml(row.zip || '—')}</dd>
        <dt>Wants to</dt><dd>${escapeHtml(interests)}</dd>
        <dt>Note from form</dt><dd>${escapeHtml(row.note || '—')}</dd>
        <dt>Signed up</dt><dd>${new Date(row.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</dd>
        <dt>Last update</dt><dd>${row.last_updated_at ? new Date(row.last_updated_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + (row.last_updated_by ? ' · by ' + escapeHtml(row.last_updated_by) : '') : '—'}</dd>
        <dt>Assigned to</dt><dd>${escapeHtml(row.assigned_to || '—')}</dd>`;
    } else {
      const fullAddr = `${row.address}, ${row.city} ${row.zip}`;
      const mapsHref = `https://maps.apple.com/?q=${encodeURIComponent(fullAddr)}`;
      detailRows = `
        <dt>Phone</dt><dd><a href="tel:${escapeHtml(row.phone)}">${escapeHtml(row.phone)}</a></dd>
        <dt>Email</dt><dd>${row.email ? `<a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a>` : '—'}</dd>
        <dt>Address</dt><dd>${escapeHtml(fullAddr)} · <a href="${mapsHref}" target="_blank" rel="noopener">Maps ↗</a></dd>
        <dt>Delivery note</dt><dd>${escapeHtml(row.note || '—')}</dd>
        <dt>Requested</dt><dd>${new Date(row.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</dd>
        <dt>Delivered</dt><dd>${row.delivered_at ? new Date(row.delivered_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : '—'}</dd>
        <dt>Last update</dt><dd>${row.last_updated_at ? new Date(row.last_updated_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + (row.last_updated_by ? ' · by ' + escapeHtml(row.last_updated_by) : '') : '—'}</dd>
        <dt>Assigned to</dt><dd>${escapeHtml(row.assigned_to || '—')}</dd>`;
    }

    const statusOptions = statuses.map(s => `<option value="${s}" ${s===status?'selected':''}>${STATUS_LABEL[s]}</option>`).join('');

    $('#drawer-body').innerHTML = `
      <span class="status-pill status-${status}">${STATUS_LABEL[status]}</span>
      <dl class="detail-grid" style="margin-top: 18px;">
        ${detailRows}
      </dl>
      <form class="update-form" id="update-form">
        <div class="form-group">
          <label for="dr-status">Status</label>
          <select class="form-control" id="dr-status" name="status">${statusOptions}</select>
        </div>
        <div class="form-group">
          <label for="dr-assigned">Assigned to</label>
          <input class="form-control" id="dr-assigned" name="assigned_to" type="text" value="${escapeHtml(row.assigned_to || '')}" placeholder="Name or initials">
        </div>
        <div class="form-group">
          <label for="dr-note">Internal note</label>
          <textarea class="form-control" id="dr-note" name="note" rows="3" placeholder="Spoke Tuesday, will phone-bank Saturday…">${escapeHtml(row.note || '')}</textarea>
        </div>
        <button class="btn btn-primary btn-lg" type="submit">Save changes</button>
      </form>`;

    $('#update-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        table,
        id: row.id,
        status: fd.get('status'),
        assigned_to: fd.get('assigned_to'),
        note: fd.get('note'),
        by: getMyInitials() || undefined,
      };
      const btn = $('#update-form button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const res = await fetch('/.netlify/functions/update-status', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Replace row in state
        const list = isVol ? STATE.volunteers : STATE.yardSigns;
        const idx = list.findIndex(r => String(r.id) === String(row.id));
        if (idx >= 0 && data.row) list[idx] = { ...list[idx], ...data.row };
        toast('Saved.');
        closeDrawer();
        renderAll();
      } catch (err) {
        toast('Could not save — try again', true);
        console.error(err);
        btn.disabled = false; btn.textContent = 'Save changes';
      }
    });
  }

  // ---- Toast ----
  let toastTimer = null;
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast${isError ? ' is-error' : ''}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // ---- CSV export ----
  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function downloadCSV(name, rows, headers) {
    const lines = [headers.join(',')];
    rows.forEach(r => lines.push(headers.map(h => csvEscape(r[h])).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('#vol-export').addEventListener('click', () => {
    const rows = filteredVolunteers().map(v => ({ ...v, interests: (v.interests || []).join('; ') }));
    downloadCSV(`hanning-volunteers-${new Date().toISOString().slice(0,10)}.csv`, rows, ['first_name','last_name','email','phone','zip','interests','status','assigned_to','note','created_at']);
  });
  $('#yard-export').addEventListener('click', () => {
    const rows = filteredYardSigns();
    downloadCSV(`hanning-yard-signs-${new Date().toISOString().slice(0,10)}.csv`, rows, ['name','phone','email','address','city','zip','status','assigned_to','note','created_at','delivered_at']);
  });

  // ---- Initial load ----
  renderWho();
  fetchAll();

  // Auto-refresh every 90 seconds
  setInterval(fetchAll, 90 * 1000);
})();
