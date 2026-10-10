import { api, ws, image } from './src/appdeploy-client';

/* PassFlow keeps a local cache, with AppDeploy database as the shared source of truth. */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const storeKey = 'passflow-v1';
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
let state = JSON.parse(
  localStorage.getItem(storeKey) ||
    '{"events":[],"students":[],"allocations":[],"payments":[],"expenses":[]}'
);
let currentView = 'dashboard',
  scanStream,
  scanLoop,
  allocationStudentId = '',
  studentSearchQuery = '',
  bulkSelectedStudentIds = new Set(),
  remoteReady = false,
  syncQueue = Promise.resolve(),
  realtimeConnection = null;
let reportFilters = { event: '', student: '', from: '', to: '' };
const hasStateData = value => Object.values(value || {}).some(list => Array.isArray(list) && list.length);
const mergeStates = (local, remote) => {
  const merged = {};
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  keys.forEach(key => {
    if (Array.isArray(local?.[key]) || Array.isArray(remote?.[key])) {
      const byId = new Map();
      [...(local?.[key] || []), ...(remote?.[key] || [])].forEach(item => {
        if (!item || typeof item !== 'object') return;
        const id = item.id || JSON.stringify(item);
        byId.set(id, { ...(byId.get(id) || {}), ...item });
      });
      merged[key] = [...byId.values()];
    } else merged[key] = remote?.[key] ?? local?.[key];
  });
  return merged;
};
const save = () => {
  localStorage.setItem(storeKey, JSON.stringify(state));
  localStorage.setItem('passflow-last-local-backup-v1', JSON.stringify(state));
  if (!remoteReady) return;
  syncQueue = syncQueue.then(() => api.put('/api/state', { state })).catch(error => {
    console.warn('Shared state sync failed:', error);
    toast('Shared data sync failed. Check the deployment settings and try again.');
  });
};
async function bootstrapSharedState() {
  const localSnapshot = JSON.parse(localStorage.getItem(storeKey) || 'null');
  if (localSnapshot) localStorage.setItem('passflow-last-local-backup-v1', JSON.stringify(localSnapshot));
  try {
    const response = await api.get('/api/state');
    const remote = response.data?.state;
    if (remote && hasStateData(remote)) {
      state = remote;
      const deduped = dedupeNavratriEvents();
      if (deduped) await api.put('/api/state', { state });
      else localStorage.setItem(storeKey, JSON.stringify(state));
      localStorage.setItem('passflow-last-local-backup-v1', JSON.stringify(state));
    } else if (hasStateData(state)) {
      dedupeNavratriEvents();
      await api.put('/api/state', { state });
    }
  } catch (error) {
    console.warn('Shared state is temporarily unavailable; using local cache.', error);
    if (import.meta.env.PROD) {
      toast('Shared data is unavailable. Check the deployment settings; changes may not sync.');
    }
  }
  remoteReady = true;
  connectRealtime();
  render();
  startSharedStateRefresh();
}
async function refreshSharedState() {
  if (!remoteReady) return;
  try {
    const response = await api.get('/api/state');
    const remote = response.data?.state;
    if (!remote || !hasStateData(remote)) return;
    state = remote;
    const deduped = dedupeNavratriEvents();
    if (deduped) await api.put('/api/state', { state });
    else localStorage.setItem(storeKey, JSON.stringify(state));
    localStorage.setItem('passflow-last-local-backup-v1', JSON.stringify(state));
    render();
  } catch (error) {
    console.warn('Shared state refresh failed:', error);
  }
}
let sharedStateRefreshTimer = null;
function startSharedStateRefresh() {
  if (sharedStateRefreshTimer) clearInterval(sharedStateRefreshTimer);
  sharedStateRefreshTimer = setInterval(refreshSharedState, 10000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSharedState();
});
window.addEventListener('focus', refreshSharedState);
function connectRealtime() {
  if (realtimeConnection || import.meta.env.PROD) return;
  try {
    realtimeConnection = ws.connect();
    realtimeConnection.onMessage(message => {
      const payload = message?.payload || message?.data || message;
      if (payload?.entity_type !== 'state' || !payload?.state) return;
      state = payload.state;
      localStorage.setItem(storeKey, JSON.stringify(state));
      render();
    });
    realtimeConnection.ready.then(() => api.post('/api/subscriptions', {
      entity_type: 'state',
      entity_id: 'global',
      connection_id: realtimeConnection.connectionId,
    })).catch(error => console.warn('Realtime subscription failed:', error));
  } catch (error) {
    console.warn('Realtime is unavailable; refresh will still sync shared data.', error);
  }
}
const uid = p =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const navratriEvents2026 = [
  { day: 1, date: '2026-10-11', week: 'Sunday', name: 'Swarnim Nagari AC Dome', artist: 'Aishwariya Majmudar', price: 950, purchasePrice: 900 },
  { day: 2, date: '2026-10-12', week: 'Monday', name: 'Shanku Sheri Circle', artist: 'Ishani Dave', price: 500, purchasePrice: 450 },
  { day: 3, date: '2026-10-13', week: 'Tuesday', name: 'Parampara Navratri AC Dome', artist: 'Kirtidan Gadhavi', price: 1000, purchasePrice: 970 },
  { day: 4, date: '2026-10-14', week: 'Wednesday', name: 'Parampara Navratri AC Dome', artist: 'Kirtidan Gadhavi', price: 1000, purchasePrice: 970 },
  { day: 5, date: '2026-10-15', week: 'Thursday', name: 'Sacred Raas / Mandli', artist: 'Hariom / Mandli', price: 700, purchasePrice: 650 },
  { day: 6, date: '2026-10-16', week: 'Friday', name: 'Sacred Raas / Mandli', artist: 'Hariom / Mandli', price: 700, purchasePrice: 650 },
  { day: 7, date: '2026-10-17', week: 'Saturday', name: 'Swarnim Nagari AC Dome', artist: 'Aishwariya Majmudar', price: 950, purchasePrice: 930 },
  { day: 8, date: '2026-10-18', week: 'Sunday', name: 'Swarnim Nagari AC Dome', artist: 'Aishwariya Majmudar', price: 950, purchasePrice: 930 },
  { day: 9, date: '2026-10-19', week: 'Monday', name: 'Swarnim Nagari AC Dome', artist: 'Aishwariya Majmudar', price: 950, purchasePrice: 930 },
];
function dedupeNavratriEvents() {
  const canonicalByDay = new Map();
  const removedIds = new Set();
  let changed = false;
  state.events.forEach(event => {
    const day = Number(event.day);
    if (!Number.isInteger(day) || day < 1 || day > 9) return;
    const existing = canonicalByDay.get(day);
    if (!existing) {
      canonicalByDay.set(day, event);
      return;
    }
    const existingScore =
      state.allocations.filter(a => a.event === existing.id).length +
      (existing.received ? 1 : 0);
    const eventScore =
      state.allocations.filter(a => a.event === event.id).length +
      (event.received ? 1 : 0);
    const canonical = eventScore > existingScore ? event : existing;
    const duplicate = canonical === event ? existing : event;
    const duplicateId = duplicate.id;
    const canonicalId = canonical.id;
    state.allocations.forEach(allocation => {
      if (allocation.event === duplicateId) allocation.event = canonicalId;
    });
    Object.assign(canonical, {
      name: canonical.name || duplicate.name,
      artist: canonical.artist || duplicate.artist,
      date: canonical.date || duplicate.date,
      week: canonical.week || duplicate.week,
      received: Math.max(Number(canonical.received || 0), Number(duplicate.received || 0)),
      price: Number(canonical.price ?? duplicate.price ?? 0),
      purchasePrice: Number(canonical.purchasePrice ?? duplicate.purchasePrice ?? 0),
      complimentaryQuota: Math.max(Number(canonical.complimentaryQuota || 0), Number(duplicate.complimentaryQuota || 0)),
    });
    removedIds.add(duplicateId);
    canonicalByDay.set(day, canonical);
    changed = true;
  });
  if (removedIds.size) {
    state.events = state.events.filter(event => !removedIds.has(event.id));
    changed = true;
  }
  return changed;
}

function ensureNavratriEvents() {
  navratriEvents2026.forEach(record => {
    const existing = state.events.find(event => Number(event.day) === record.day);
    if (existing) {
      if (existing.received == null) existing.received = 0;
      if (existing.complimentaryQuota == null) existing.complimentaryQuota = 0;
    } else {
      state.events.push({ ...record, id: uid('EV'), received: 0, complimentaryQuota: 0 });
    }
  });
  save();
}
ensureNavratriEvents();

const money = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const dateFmt = d =>
  d
    ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';
const eventOf = id => state.events.find(x => x.id === id);
const studentOf = id => state.students.find(x => x.id === id);
const allocationPaid = id =>
  state.payments
    .filter(p => p.allocation === id)
    .reduce((s, p) => s + Number(p.amount), 0);
const allocationStudentPrice = a =>
  Number(a.studentPrice ?? eventOf(a.event)?.price ?? 0);
const allocationDue = a =>
  a.complimentary
    ? 0
    : Number(a.saleAmount ?? Number(a.quantity) * allocationStudentPrice(a));
const allocationStatus = a =>
  a.handover ? 'Handed Over' : a.issued ? 'Issued' : 'Pending';
const eventIssued = id =>
  state.allocations
    .filter(a => a.event === id && a.issued)
    .reduce((n, a) => n + Number(a.quantity), 0);
const eventComplimentaryIssued = id =>
  state.allocations
    .filter(a => a.event === id && a.issued && a.complimentary)
    .reduce((n, a) => n + Number(a.quantity), 0);
const eventComplimentaryRemaining = id =>
  Math.max(0, Number(eventOf(id)?.complimentaryQuota || 0) - eventComplimentaryIssued(id));
const esc = v =>
  String(v ?? '').replace(
    /[&<>'"]/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        c
      ]
  );
function toast(text) {
  const e = $('#toast');
  e.textContent = text;
  e.classList.add('show');
  setTimeout(() => e.classList.remove('show'), 3000);
}
function openModal(id) {
  $('#modalBackdrop').classList.add('open');
  $(`#${id}`).classList.add('open');
  if (id === 'allocationModal') {
    prepareAllocation(allocationStudentId);
    allocationStudentId = '';
  }
  if (id === 'studentModal') prepareStudentIssue();
  if (id === 'studentOcrModal') renderStudentOcrPreview();
}
function closeModals() {
  $$('.modal.open').forEach(x => x.classList.remove('open'));
  $('#modalBackdrop').classList.remove('open');
  stopScanner();
}
function statusTag(status) {
  return `<span class="tag ${status === 'Pending' ? 'pending' : status === 'Handed Over' ? 'hand' : ''}">${status}</span>`;
}
function render() {
  const hour = new Date().getHours(),
    greeting =
      hour < 12
        ? 'Good morning'
        : hour < 17
          ? 'Good afternoon'
          : 'Good evening';
  const meta = {
    dashboard: ['OVERVIEW', `${greeting}, admin.`],
    events: ['EVENT OPERATIONS', 'Manage your 9-day event calendar'],
    students: ['STUDENT DIRECTORY', 'Students and their pass status'],
    allocations: ['PASS OPERATIONS', 'Issued pass allocations & QR PDFs'],
    payments: ['PAYMENT COLLECTION', 'Record cash and online collections'],
    expenses: ['FINANCE', 'Expenses and cost tracking'],
    reports: ['ANALYTICS', 'Sales, collection and margin overview'],
  }[currentView];
  $('#pageKicker').textContent = meta[0];
  $('#pageTitle').textContent = meta[1];
  $('#app').innerHTML = {
    dashboard,
    events,
    students,
    allocations,
    payments,
    expenses,
    reports,
  }[currentView]();
  labelMobileTableCells();
  if (currentView === 'students') applyStudentSearch();
}
function applyStudentSearch() {
  const query = studentSearchQuery.trim().toLocaleLowerCase();
  $$('#studentRows tr').forEach(row => {
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
  });
}
function labelMobileTableCells() {
  $$('.table-wrap table').forEach(table => {
    const headings = $$('thead th', table).map(h => h.textContent.trim());
    $$('tbody tr', table).forEach(row =>
      $$('td', row).forEach((cell, index) => {
        if (!cell.classList.contains('empty'))
          cell.dataset.label = headings[index] || '';
      })
    );
  });
}
function dashboard() {
  const received = state.events.reduce((n, e) => n + Number(e.received), 0),
    issued = state.allocations
      .filter(a => a.issued)
      .reduce((n, a) => n + Number(a.quantity), 0),
    collection = state.payments.reduce((n, p) => n + Number(p.amount), 0),
    due = state.allocations.reduce((n, a) => n + allocationDue(a), 0),
    expenses = state.expenses.reduce((n, e) => n + Number(e.amount), 0),
    purchaseCost = state.allocations
      .filter(a => a.issued)
      .reduce(
        (n, a) =>
          n + Number(a.quantity) * Number(eventOf(a.event)?.purchasePrice || 0),
        0
      );
  const dayRows =
    state.events
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(e => {
        let i = eventIssued(e.id);
        return `<div class="bar-row"><span>${esc(e.day)}</span><div class="bar"><span style="width:${e.received ? Math.min(100, (i / e.received) * 100) : 0}%"></span></div><b>${i}/${e.received}</b></div>`;
      })
      .join('') ||
    '<div class="empty">Add events to see the day-wise summary.</div>';
  return `<div class="stat-grid">
    <div class="stat"><div class="stat-label">TOTAL STUDENTS</div><div class="stat-value">${state.students.length}</div><div class="stat-note">Registered student profiles</div></div>
    <div class="stat"><div class="stat-label">TOTAL EVENTS</div><div class="stat-value">${state.events.length}</div><div class="stat-note">Events in your calendar</div></div>
    <div class="stat"><div class="stat-label">PASSES RECEIVED</div><div class="stat-value">${received}</div><div class="stat-note">Total inventory received</div></div>
    <div class="stat"><div class="stat-label">PASSES ISSUED</div><div class="stat-value">${issued}</div><div class="stat-note"><span class="accent">${received ? Math.round((issued / received) * 100) : 0}%</span> of received passes</div></div>
    <div class="stat"><div class="stat-label">PASSES REMAINING</div><div class="stat-value">${Math.max(0, received - issued)}</div><div class="stat-note">Available in event inventory</div></div>
    <div class="stat"><div class="stat-label">TOTAL COLLECTION</div><div class="stat-value">${money(collection)}</div><div class="stat-note">Amount collected so far</div></div>
    <div class="stat"><div class="stat-label">PASS VALUE ISSUED</div><div class="stat-value">${money(due)}</div><div class="stat-note">Value of issued passes</div></div>
    <div class="stat"><div class="stat-label">EXPENSES</div><div class="stat-value">${money(expenses)}</div><div class="stat-note">Estimated profit ${money(collection - purchaseCost - expenses)}</div></div>
  </div><div class="layout"><div class="card"><div class="card-head"><div><h2>Day-wise pass summary</h2><p class="sub">Issued versus received passes</p></div><button class="table-action" data-view-go="events">View events →</button></div>${dayRows}</div><div class="card"><div class="card-head"><div><h2>Quick access</h2><p class="sub">Keep gate operations moving</p></div></div><div class="quick-actions"><button data-open="eventModal"><b>＋</b>Add event</button><button data-open="studentModal"><b>♙</b>Add student</button><button data-open="allocationModal"><b>▣</b>Allocate pass</button><button data-action="scan"><b>⌁</b>Scan QR</button><button data-action="bulk-allocate"><b>＋</b>Bulk Allocate Passes</button></div></div></div>`;
}
function events() {
  const rows = state.events
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(e => {
      let issued = eventIssued(e.id);
      return `<tr><td><b>${esc(e.name)}</b><br><small>${esc(e.artist || 'No artist')}</small></td><td>${esc(e.day)}<br><small>${dateFmt(e.date)}</small></td><td>${e.received}</td><td>${issued}</td><td><b>${Number(e.received) - issued}</b></td><td><b>${eventComplimentaryIssued(e.id)}/${Number(e.complimentaryQuota || 0)}</b><br><small>${eventComplimentaryRemaining(e.id)} free left</small></td><td>${money(e.price)}</td><td>${money(e.purchasePrice)}</td><td><button class="table-action" data-edit-event="${e.id}">Edit</button><button class="table-action delete" data-delete-event="${e.id}">Delete</button></td></tr>`;
    })
    .join('');
  return `<div class="section-title"><h2>All events <small>(${state.events.length} total)</small></h2><button class="primary" data-open="eventModal">+ Add event</button></div><div class="card table-wrap"><table><thead><tr><th>Event / artist</th><th>Day & date</th><th>Received</th><th>Issued</th><th>Remaining</th><th>Complimentary</th><th>Student price</th><th>Purchase price</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty">No events yet. Add your first event.</td></tr>'}</tbody></table></div>`;
}
function students() {
  const rows = state.students
    .map(s => {
      let a = state.allocations.filter(a => a.student === s.id),
        issued = a.filter(a => a.issued && !a.handover).length,
        hand = a.filter(a => a.handover).length,
        pending = a.filter(a => !a.issued).length;
      let paid = a.reduce((n, x) => n + allocationPaid(x.id), 0),
        due = a.reduce((n, x) => n + allocationDue(x), 0);
      return `<tr><td><b>${esc(s.name)}</b><br><small>${esc(s.mobile)}</small></td><td><b>${issued}</b> Issued · <b>${hand}</b> Handed over · <b>${pending}</b> Pending</td><td>${money(paid)}</td><td><button class="table-action" data-issue-student="${s.id}">Issue pass</button><button class="table-action" data-whatsapp="${s.id}">WhatsApp PDF</button><button class="table-action" data-student-history="${s.id}">History</button><button class="table-action" data-edit-student="${s.id}">Edit</button><button class="table-action delete" data-delete-student="${s.id}">Delete</button></td></tr>`;
    })
    .join('');
  return `<div class="section-title"><h2>Students</h2><div class="toolbar"><input id="studentSearch" class="search" placeholder="Search name or mobile" value="${esc(studentSearchQuery)}"><button class="primary" data-open="studentModal">+ Add student</button></div></div><div class="card table-wrap"><table><thead><tr><th>Student</th><th>Pass status</th><th>Collection received</th><th></th></tr></thead><tbody id="studentRows">${rows || '<tr><td colspan="5" class="empty">No students registered.</td></tr>'}</tbody></table></div>`;
}
function allocations() {
  const rows = state.allocations
    .sort((a, b) =>
      (eventOf(a.event)?.date || '').localeCompare(eventOf(b.event)?.date || '')
    )
    .map(a => {
      let e = eventOf(a.event),
        s = studentOf(a.student),
        due = allocationDue(a),
        paid = allocationPaid(a.id);
      return `<tr><td><b>${esc(s?.name || 'Deleted student')}</b><br><small>${esc(s?.mobile || '')}</small></td><td>${esc(e?.name || 'Deleted event')}<br><small>${dateFmt(e?.date)}</small></td><td>${a.quantity}</td><td>${a.complimentary ? '<span class="tag">Complimentary</span>' : `${money(paid)} / ${money(due)}`}</td><td>${statusTag(allocationStatus(a))}</td><td><button class="table-action" data-pdf="${a.id}">QR PDF</button>${a.issued ? `<button class="table-action" data-payment="${a.id}">Payment</button>` : `<button class="table-action" data-issue="${a.id}">Issue</button>`}<button class="table-action delete" data-delete-allocation="${a.id}">Delete pass</button></td></tr>`;
    })
    .join('');
  return `<div class="section-title"><h2>Pass allocations</h2><button class="primary" data-open="allocationModal">+ New allocation</button></div><div class="card table-wrap"><table><thead><tr><th>Student</th><th>Event</th><th>Passes</th><th>Collection</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No allocations yet.</td></tr>'}</tbody></table></div>`;
}
function payments() {
  const rows = state.allocations
    .filter(a => a.issued)
    .map(a => {
      let s = studentOf(a.student),
        e = eventOf(a.event),
        due = allocationDue(a),
        paid = allocationPaid(a.id);
      return `<tr><td><b>${esc(s?.name || '—')}</b><br><small>${esc(e?.name || '—')}</small></td><td>${a.complimentary ? 'Complimentary' : money(due)}</td><td>${money(paid)}</td><td>${money(Math.max(0, due - paid))}</td><td>${
        state.payments
          .filter(p => p.allocation === a.id)
          .map(p => `${dateFmt(p.date)} · ${p.mode} · ${money(p.amount)}`)
          .join('<br>') || '—'
      }</td><td>${!a.complimentary && paid < due ? `<button class="table-action" data-payment="${a.id}">Add payment</button>` : '—'}</td></tr>`;
    })
    .join('');
  return `<div class="section-title"><h2>Payment collection</h2></div><div class="card table-wrap"><table><thead><tr><th>Student / Event</th><th>Total</th><th>Paid</th><th>Pending</th><th>Payment history</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Issue a pass to record payments.</td></tr>'}</tbody></table></div>`;
}
function expenses() {
  const rows = state.expenses
    .map(
      e =>
        `<tr><td><b>${esc(e.title)}</b><br><small>${esc(e.notes || '')}</small></td><td>${esc(e.category)}</td><td>${dateFmt(e.date)}</td><td>${esc(e.mode)}</td><td>${money(e.amount)}</td><td><button class="table-action" data-edit-expense="${e.id}">Edit</button><button class="table-action delete" data-delete-expense="${e.id}">Delete</button></td></tr>`
    )
    .join('');
  return `<div class="section-title"><h2>Expenses</h2><button class="primary" data-open="expenseModal">+ Add expense</button></div><div class="card table-wrap"><table><thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Mode</th><th>Amount</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No expenses recorded.</td></tr>'}</tbody></table></div>`;
}
function reports() {
  const filteredEvents = state.events.filter(
    e =>
      (!reportFilters.event || e.id === reportFilters.event) &&
      (!reportFilters.from || e.date >= reportFilters.from) &&
      (!reportFilters.to || e.date <= reportFilters.to)
  );
  const eventIds = new Set(filteredEvents.map(e => e.id));
  const allocations = state.allocations.filter(
    a =>
      eventIds.has(a.event) &&
      (!reportFilters.student || a.student === reportFilters.student)
  );
  const allocationIds = new Set(allocations.map(a => a.id));
  const received = filteredEvents.reduce((n, e) => n + Number(e.received), 0),
    issued = allocations
      .filter(a => a.issued)
      .reduce((n, a) => n + Number(a.quantity), 0),
    sales = allocations.reduce((n, a) => n + allocationDue(a), 0),
    paid = state.payments
      .filter(p => allocationIds.has(p.allocation))
      .reduce((n, p) => n + Number(p.amount), 0),
    cost = allocations
      .filter(a => a.issued)
      .reduce(
        (n, a) =>
          n + Number(a.quantity) * Number(eventOf(a.event)?.purchasePrice || 0),
        0
      ),
    expenses = state.expenses
      .filter(
        x =>
          (!reportFilters.from || x.date >= reportFilters.from) &&
          (!reportFilters.to || x.date <= reportFilters.to)
      )
      .reduce((n, e) => n + Number(e.amount), 0);
  const eventOptions = state.events
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(
      e =>
        `<option value="${e.id}" ${reportFilters.event === e.id ? 'selected' : ''}>${esc(e.day)} · ${esc(e.name)}</option>`
    )
    .join('');
  const studentOptions = state.students
    .map(
      s =>
        `<option value="${s.id}" ${reportFilters.student === s.id ? 'selected' : ''}>${esc(s.name)} · ${esc(s.mobile)}</option>`
    )
    .join('');
  const eventRows = filteredEvents
    .map(e => {
      let list = allocations.filter(a => a.event === e.id && a.issued),
        q = list.reduce((n, a) => n + Number(a.quantity), 0),
        value = list.reduce((n, a) => n + allocationDue(a), 0),
        purchase = q * Number(e.purchasePrice || 0);
      return `<tr><td><b>${e.day} · ${esc(e.name)}</b><br><small>${dateFmt(e.date)}</small></td><td>${q}</td><td>${money(value)}</td><td>${money(purchase)}</td><td>${money(value - purchase)}</td></tr>`;
    })
    .join('');
  const students = state.students.filter(
    s => !reportFilters.student || s.id === reportFilters.student
  );
  const studentRows = students
    .map(s => {
      let list = allocations.filter(a => a.student === s.id),
        issuedQty = list
          .filter(a => a.issued)
          .reduce((n, a) => n + Number(a.quantity), 0),
        value = list.reduce((n, a) => n + allocationDue(a), 0),
        amount = state.payments
          .filter(p => list.some(a => a.id === p.allocation))
          .reduce((n, p) => n + Number(p.amount), 0);
      return `<tr><td><b>${esc(s.name)}</b><br><small>${esc(s.mobile)}</small></td><td>${issuedQty}</td><td>${money(value)}</td><td>${money(amount)}</td><td>${money(Math.max(0, value - amount))}</td></tr>`;
    })
    .join('');
  return `<div class="section-title"><h2>Reports</h2><div class="toolbar"><button class="ghost" data-export="csv">Export Excel (CSV)</button><button class="primary" data-export="pdf">Export PDF</button></div></div><div class="card report-filters"><div class="card-head"><div><h2>Customize report</h2><p class="sub">Filter by event, student, or date range.</p></div><button class="table-action" data-clear-report>Clear filters</button></div><div class="form-grid"><label>Event<select id="reportEvent"><option value="">All events</option>${eventOptions}</select></label><label>Student<select id="reportStudent"><option value="">All students</option>${studentOptions}</select></label><label>From date<input id="reportFrom" type="date" value="${reportFilters.from}"></label><label>To date<input id="reportTo" type="date" value="${reportFilters.to}"></label></div></div><div class="report-grid" style="margin-top:15px"><div class="report-card">Passes received<strong>${received}</strong><small>${issued} issued · ${received - issued} remaining</small></div><div class="report-card">Sales value<strong>${money(sales)}</strong><small>${money(Math.max(0, sales - paid))} pending payments</small></div><div class="report-card">Estimated margin<strong>${money(paid - cost - expenses)}</strong><small>Collections minus pass cost & expenses</small></div></div><div class="card table-wrap" style="margin-top:20px"><div class="card-head"><div><h2>Event-wise sales & margin</h2><p class="sub">Based on the selected filters</p></div></div><table><thead><tr><th>Event</th><th>Issued</th><th>Sales value</th><th>Purchase cost</th><th>Margin potential</th></tr></thead><tbody>${eventRows || '<tr><td colspan="5" class="empty">No matching event data.</td></tr>'}</tbody></table></div><div class="card table-wrap" style="margin-top:20px"><div class="card-head"><div><h2>Student-wise collection</h2><p class="sub">Passes, collections, and outstanding balance</p></div></div><table><thead><tr><th>Student</th><th>Issued</th><th>Total value</th><th>Paid</th><th>Pending</th></tr></thead><tbody>${studentRows || '<tr><td colspan="5" class="empty">No matching student data.</td></tr>'}</tbody></table></div>`;
}
function prepareBulkAllocation() {
  const form = $('#bulkAllocationForm');
  form.reset();
  form.elements.quantity.value = 1;
  bulkSelectedStudentIds = new Set();
  $('#bulkEvent').innerHTML = '<option value="">Select event / day</option>' + state.events.slice().sort((x, y) => (x.date || '').localeCompare(y.date || '')).map(e => {
    const left = Math.max(0, Number(e.received || 0) - eventIssued(e.id));
    const free = eventComplimentaryRemaining(e.id);
    return '<option value="' + e.id + '">' + esc(e.day) + ' · ' + esc(e.name) + ' · ' + dateFmt(e.date) + ' · ' + esc(e.artist || 'No artist') + ' · ' + left + ' passes left · ' + free + ' free left</option>';
  }).join('');
  renderBulkStudents();
  updateBulkAllocationSummary();
}
function renderBulkStudents() {
  const q = ($('#bulkStudentSearch')?.value || '').toLowerCase().trim();
  const eventId = $('#bulkAllocationForm [name=event]')?.value || '';
  const list = $('#bulkStudentList');
  if (!list) return;
  const visible = state.students.filter(s => !q || (s.name + ' ' + s.mobile).toLowerCase().includes(q));
  list.innerHTML = visible.map(s => {
    const alreadyAllocated = eventId && state.allocations.some(a => a.student === s.id && a.event === eventId && !a.handover);
    if (alreadyAllocated) bulkSelectedStudentIds.delete(s.id);
    return '<label class="event-choice ' + (alreadyAllocated ? 'disabled' : '') + '"><input type="checkbox" name="bulkStudents" value="' + s.id + '" ' + (alreadyAllocated ? 'disabled' : '') + (bulkSelectedStudentIds.has(s.id) ? ' checked' : '') + '><span><b>' + esc(s.name) + '</b><small>' + esc(s.mobile) + (alreadyAllocated ? ' · Already allocated for this event' : '') + '</small></span></label>';
  }).join('') || '<div class="empty">No matching students.</div>';
  updateBulkAllocationSummary();
}
function updateBulkAllocationSummary() {
  const checked = $$('#bulkStudentList input[name=bulkStudents]:checked');
  const selected = checked.length;
  const qty = Number($('#bulkAllocationForm [name=quantity]')?.value || 0);
  const event = eventOf($('#bulkAllocationForm [name=event]')?.value);
  const comp = $('#bulkAllocationForm [name=complimentary]')?.checked;
  const capacity = event ? Math.max(0, Number(event.received || 0) - eventIssued(event.id)) : 0;
  const free = event ? eventComplimentaryRemaining(event.id) : 0;
  const total = selected * qty;
  const selectAll = $('#bulkSelectAll');
  const visibleBoxes = $$('#bulkStudentList input[name=bulkStudents]:not(:disabled)');
  if (selectAll) {
    selectAll.checked = visibleBoxes.length > 0 && checked.length === visibleBoxes.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < visibleBoxes.length;
  }
  $('#bulkAllocationSummary').textContent = event
    ? selected + ' students × ' + qty + ' pass' + (qty === 1 ? '' : 'es') + ' = ' + total + ' passes · ' + capacity + ' inventory left' + (comp ? ' · ' + free + ' complimentary left' : '')
    : selected + ' students selected';
}
function submitBulkAllocation(e) {
  e.preventDefault();
  const form = $('#bulkAllocationForm');
  const eventId = form.elements.event.value;
  const quantity = Number(form.elements.quantity.value);
  const studentIds = [...bulkSelectedStudentIds];
  const complimentary = form.elements.complimentary.checked;
  const event = eventOf(eventId);
  if (!event || !studentIds.length || !Number.isInteger(quantity) || quantity < 1) {
    toast('Select an event, at least one student, and a valid quantity.');
    return;
  }
  const eligible = studentIds.filter(id => !state.allocations.some(a => a.student === id && a.event === eventId && !a.handover));
  if (!eligible.length) {
    toast('All selected students already have an active allocation for this event.');
    bulkSelectedStudentIds = new Set();
    renderBulkStudents();
    return;
  }
  const needed = eligible.length * quantity;
  const remainingInventory = Number(event.received || 0) - eventIssued(eventId);
  if (remainingInventory < needed) {
    toast(event.name + ' has only ' + Math.max(0, remainingInventory) + ' passes left; ' + needed + ' are required.');
    return;
  }
  if (complimentary && eventComplimentaryRemaining(eventId) < needed) {
    toast('Only ' + eventComplimentaryRemaining(eventId) + ' complimentary passes remain for this event; ' + needed + ' are required.');
    return;
  }
  eligible.forEach(student => state.allocations.push({
    id: uid('AL'),
    student,
    event: eventId,
    quantity,
    studentPrice: Number(event.price),
    saleAmount: complimentary ? 0 : Number(event.price) * quantity,
    complimentary,
    issued: true,
    issuedDate: today,
    handover: false
  }));
  save();
  bulkSelectedStudentIds = new Set();
  closeModals();
  render();
  toast(eligible.length + ' student(s) allocated ' + needed + ' pass(es) for ' + event.name + '.');
}

function prepareAllocation(selectedStudentId = '') {
  let form = $('#allocationForm');
  form.reset();
  form.querySelector('[name=quantity]').value = 1;
  form.querySelector('[name=paidAmount]').value = 0;
  delete form.querySelector('[name=paidAmount]').dataset.edited;
  form.querySelector('[name=paymentDate]').value = today;
  let select = $('#allocationForm [name=student]');
  select.innerHTML =
    '<option value="">Select student</option>' +
    state.students
      .map(
        s =>
          `<option value="${s.id}">${esc(s.name)} · ${esc(s.mobile)}</option>`
      )
      .join('');
  if (selectedStudentId) select.value = selectedStudentId;
  $('#allocationEvents').innerHTML =
    state.events
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(e => {
        let left = e.received - eventIssued(e.id);
        return `<label class="event-choice"><input type="checkbox" name="events" value="${e.id}" ${left <= 0 ? 'disabled' : ''}><span><b>${e.day} · ${esc(e.name)}</b><small>${dateFmt(e.date)} · ${money(e.price)} · ${left} left</small></span></label>`;
      })
      .join('') ||
    '<div class="empty">Add events before allocating passes.</div>';
  updateAllocationTotal();
}
function updateAllocationTotal() {
  let form = $('#allocationForm'),
    q = +form?.querySelector('[name=quantity]')?.value || 0,
    ids = $$('#allocationEvents input:checked').map(i => i.value),
    custom = form?.querySelector('[name=customTotal]')?.value,
    amount =
      custom === ''
        ? ids.reduce((n, id) => n + +eventOf(id).price * q, 0)
        : +custom,
    comp = form?.querySelector('[name=complimentary]')?.checked,
    payment = form?.querySelector('[name=paidAmount]');
  if (comp) amount = 0;
  $('#allocationTotal').textContent = money(amount);
  if (payment) {
    payment.max = amount;
    payment.disabled = !!comp;
    if (comp) payment.value = 0;
    else if (payment.dataset.edited !== 'true') payment.value = amount;
  }
}
function prepareStudentIssue() {
  const form = $('#studentForm'),
    date = form.querySelector('[name=studentPaymentDate]');
  if (!date) return;
  const editingStudentId = form.elements.id.value;
  form.querySelector('[name=studentQuantity]').value = 1;
  form.querySelector('[name=studentCustomTotal]').value = '';
  form.querySelector('[name=studentPaidAmount]').value = 0;
  delete form.querySelector('[name=studentPaidAmount]').dataset.edited;
  date.value = today;
  const list = $('#studentIssueEvents'),
    selectAll = $('#studentSelectAllEvents');
  selectAll.checked = false;
  selectAll.indeterminate = false;
  selectAll.disabled = !state.events.some(event => event.received - eventIssued(event.id) > 0);
  list.innerHTML = state.events
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(event => {
      const existing = editingStudentId
        ? state.allocations.find(a => a.student === editingStudentId && a.event === event.id)
        : null;
      const left = event.received - eventIssued(event.id);
      const disabled = left <= 0 && !existing;
      const quantity = existing ? Number(existing.quantity) : '';
      const status = existing
        ? `Already allocated · current quantity ${existing.quantity}`
        : `${dateFmt(event.date)} · ${money(event.price)} · ${left} left`;
      return `<div class="event-choice">
        <label class="event-choice-main"><input type="checkbox" name="studentEvents" value="${event.id}" ${existing ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span><b>Day ${esc(event.day)} · ${esc(event.name)}</b><small>${status}</small></span></label>
        <label class="event-quantity">Qty <input type="number" name="studentEventQuantity" data-event-id="${event.id}" data-existing="${existing ? 'true' : 'false'}" data-custom="${existing ? 'true' : 'false'}" min="1" max="${Math.max(1, left + Number(existing?.quantity || 0))}" value="${quantity}" placeholder="Common"></label>
      </div>`;
    }).join('') || '<div class="empty">Add events before issuing a pass.</div>';
  updateStudentIssueTotal();
  syncStudentIssueMode();
}
function syncStudentIssueMode() {
  const form = $('#studentForm'), enabled = !!form.elements.issueNow.checked,
    panel = $('.issue-on-create', form);
  panel.hidden = !enabled;
  panel.querySelectorAll('input, select').forEach(input => { input.disabled = !enabled; });
  ['studentQuantity', 'studentPaidAmount', 'studentPaymentDate'].forEach(name => {
    form.elements[name].required = enabled;
  });
  $('#studentSubmitButton').textContent = enabled ? 'Save student & issue QR pass' : 'Save student profile';
}
function syncCommonStudentQuantities(onlySelected = true) {
  const form = $('#studentForm'),
    common = Math.max(1, Number(form.querySelector('[name=studentQuantity]')?.value) || 1);
  $$(`#studentIssueEvents input[name="studentEventQuantity"]`).forEach(input => {
    const checkbox = $(`#studentIssueEvents input[name="studentEvents"][value="${input.dataset.eventId}"]`);
    if (input.dataset.custom === 'true' || input.dataset.existing === 'true') return;
    if (onlySelected && !checkbox?.checked) return;
    input.value = checkbox?.checked ? String(common) : '';
  });
}
function updateStudentIssueTotal() {
  const form = $('#studentForm'),
    commonQuantity = Number(form?.querySelector('[name=studentQuantity]')?.value) || 1,
    selected = selectedEventQuantities('#studentIssueEvents', 'studentEvents', 'studentEventQuantity', commonQuantity),
    custom = form?.querySelector('[name=studentCustomTotal]')?.value,
    existingStudentId = form?.elements.id.value,
    amount = selected.reduce((sum, item) => {
      const eventPrice = Number(eventOf(item.id)?.price || 0),
        existing = existingStudentId ? state.allocations.find(a => a.student === existingStudentId && a.event === item.id) : null,
        increase = existing ? Math.max(0, item.quantity - Number(existing.quantity || 0)) : item.quantity;
      return sum + eventPrice * increase;
    }, 0) + (custom === '' ? 0 : Number(custom)),
    comp = form?.querySelector('[name=studentComplimentary]')?.checked,
    payment = form?.querySelector('[name=studentPaidAmount]');
  $('#studentIssueTotal').textContent = money(comp ? 0 : amount);
  if (payment) {
    payment.max = Math.max(0, amount);
    payment.disabled = !!comp;
    if (comp) payment.value = 0;
    else if (payment.dataset.edited !== 'true') payment.value = amount;
  }
}
function splitCustomTotal(eventIds, quantity, total) {
  const base = eventIds.map(id => Number(eventOf(id)?.price || 0) * quantity),
    baseTotal = base.reduce((sum, value) => sum + value, 0);
  if (!baseTotal)
    return eventIds.map((id, index) => ({
      id,
      amount: index === 0 ? total : 0,
    }));
  let remaining = total;
  return eventIds.map((id, index) => {
    const amount =
      index === eventIds.length - 1
        ? remaining
        : Math.round((total * base[index]) / baseTotal);
    remaining -= amount;
    return { id, amount };
  });
}
function selectedEventQuantities(containerSelector, checkboxName, quantityName, defaultQuantity) {
  return $$(`${containerSelector} input[name="${checkboxName}"]:checked`).map(input => {
    const override = $(`${containerSelector} input[name="${quantityName}"][data-event-id="${input.value}"]`)?.value;
    const quantity = override === '' || override == null ? Number(defaultQuantity) : Number(override);
    return { id: input.value, quantity };
  });
}
function waUrl(s, text = '') {
  const number = whatsappNumber(s);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
function whatsappNumber(s) {
  const number = String(s?.mobile || '').replace(/\D/g, '');
  return number.length === 10 ? `91${number}` : number;
}
function cellText(value) {
  return String(value ?? '').trim();
}
function importDate(value) {
  if (!value) return today;
  const text = cellText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
function field(row, name) {
  return row[name] ?? row[name.trim()] ?? '';
}
function normalizeStudentName(value) {
  return cellText(value).replace(/\s+/g, ' ').trim().toLowerCase();
}
function normalizeStudentMobile(value) {
  return cellText(value).replace(/\D/g, '');
}
function studentKey(name, mobile) {
  return `${normalizeStudentName(name)}|${normalizeStudentMobile(mobile)}`;
}
function studentExistsByNameMobile(name, mobile) {
  const key = studentKey(name, mobile);
  return state.students.some(student => studentKey(student.name, student.mobile) === key);
}
function importStudentsWorkbook(file) {
  if (!window.XLSX) {
    toast('Excel importer is loading. Please retry in a moment.');
    return;
  }
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const book = XLSX.read(event.target.result, {
          type: 'array',
          cellDates: true,
        }),
        firstSheet = book.Sheets[book.SheetNames[0]];
      if (!firstSheet) {
        toast('The Excel file does not contain a worksheet.');
        return;
      }
      const rows = XLSX.utils.sheet_to_json(firstSheet, {
        defval: '',
        raw: false,
      });
      let added = 0,
        skipped = 0,
        errors = [];
      const seenKeys = new Set(state.students.map(student => studentKey(student.name, student.mobile)));
      rows.forEach((row, index) => {
        const name = cellText(field(row, 'Student Name')),
          mobile = normalizeStudentMobile(field(row, 'Mobile Number'));
        if (!name && !mobile) return;
        if (!name || mobile.length < 8 || mobile.length > 15) {
          errors.push(`Row ${index + 2}`);
          return;
        }
        const key = studentKey(name, mobile);
        if (seenKeys.has(key)) {
          skipped++;
          return;
        }
        state.students.push({
          id: uid('ST'),
          name,
          mobile,
        });
        seenKeys.add(key);
        added++;
      });
      if (added > 0) save();
      render();
      const errorText = errors.length
        ? ` ${errors.length} row(s) skipped because Student Name or Mobile Number is invalid.`
        : '';
      toast(
        `${added} student profile(s) imported.${skipped ? ` ${skipped} duplicate name + mobile row(s) skipped.` : ''}${errorText}`
      );
      if (errors.length)
        console.warn('Student import rows needing correction:', errors);
    } catch (error) {
      console.error(error);
      toast('Could not read this Excel file. Use columns: Student Name and Mobile Number.');
    }
  };
  reader.readAsArrayBuffer(file);
}

let studentOcrRows = [];

function studentOcrStatus(row, index, rows = studentOcrRows) {
  const name = cellText(row.name).replace(/\s+/g, ' ').trim();
  const mobile = normalizeStudentMobile(row.mobile);
  if (!name || mobile.length < 8 || mobile.length > 15) {
    return { kind: 'review', label: 'Review', reason: 'Name or mobile is invalid' };
  }
  if (studentExistsByNameMobile(name, mobile)) {
    return { kind: 'duplicate', label: 'Duplicate', reason: 'Same name + mobile already exists' };
  }
  const key = studentKey(name, mobile);
  const earlier = rows.slice(0, index).some(item => studentKey(item.name, item.mobile) === key);
  if (earlier) {
    return { kind: 'duplicate', label: 'Duplicate', reason: 'Repeated in this screenshot' };
  }
  return { kind: 'new', label: 'New', reason: 'Will be added' };
}

function renderStudentOcrPreview() {
  const container = $('#studentOcrRows');
  if (!container) return;
  container.innerHTML = studentOcrRows.map((row, index) => {
    const status = studentOcrStatus(row, index);
    const checked = status.kind === 'new' ? ' checked' : '';
    const disabled = status.kind === 'new' ? '' : ' disabled';
    return `<tr data-ocr-row="${index}">
      <td><input type="checkbox" data-ocr-select="${index}"${checked}${disabled}></td>
      <td><input class="ocr-input" data-ocr-name="${index}" value="${esc(row.name)}" placeholder="Student name"></td>
      <td><input class="ocr-input" data-ocr-mobile="${index}" value="${esc(row.mobile)}" inputmode="numeric" placeholder="Mobile number"></td>
      <td><span class="tag ${status.kind === 'duplicate' ? 'pending' : ''}" data-ocr-status="${index}">${esc(status.label)}</span><small data-ocr-reason="${index}">${esc(status.reason)}</small></td>
    </tr>`;
  }).join('');
  updateStudentOcrSummary();
}

function updateStudentOcrSummary() {
  studentOcrRows.forEach((row, index) => {
    const nameInput = $(`[data-ocr-name="${index}"]`);
    const mobileInput = $(`[data-ocr-mobile="${index}"]`);
    if (nameInput) row.name = nameInput.value;
    if (mobileInput) row.mobile = mobileInput.value;
  });
  let newCount = 0,
    duplicateCount = 0,
    reviewCount = 0;
  studentOcrRows.forEach((row, index) => {
    const status = studentOcrStatus(row, index);
    if (status.kind === 'new') newCount++;
    else if (status.kind === 'duplicate') duplicateCount++;
    else reviewCount++;
    const checkbox = $(`[data-ocr-select="${index}"]`);
    const statusEl = $(`[data-ocr-status="${index}"]`);
    const reasonEl = $(`[data-ocr-reason="${index}"]`);
    if (checkbox) {
      checkbox.disabled = status.kind !== 'new';
      if (status.kind !== 'new') checkbox.checked = false;
    }
    if (statusEl) {
      statusEl.textContent = status.label;
      statusEl.className = `tag ${status.kind === 'duplicate' ? 'pending' : status.kind === 'review' ? 'hand' : ''}`;
    }
    if (reasonEl) reasonEl.textContent = status.reason;
  });
  const summary = $('#studentOcrSummary');
  if (summary) summary.textContent = `${newCount} new · ${duplicateCount} duplicate · ${reviewCount} review`;
  const addButton = $('#studentOcrAddButton');
  if (addButton) addButton.disabled = newCount === 0;
}

async function importStudentScreenshots(files) {
  const selectedFiles = [...files].filter(file => file.type.startsWith('image/')).slice(0, 5);
  if (!selectedFiles.length) {
    toast('Please choose a screenshot image.');
    return;
  }
  closeModals();
  toast('Reading screenshot…');
  try {
    const rows = [];
    for (const file of selectedFiles) {
      const prepared = await image.resizeIfNeeded(file, {
        maxDimension: 1600,
        maxPixels: 2000000,
        quality: 0.84,
        mimeType: 'image/jpeg',
      });
      const response = await api.post('/api/ocr/students', {
        images: [{ data: prepared.data, mimeType: prepared.mimeType }],
      });
      const extracted = Array.isArray(response.data?.students) ? response.data.students : [];
      extracted.forEach(item => {
        rows.push({
          name: cellText(item?.name),
          mobile: normalizeStudentMobile(item?.mobile),
        });
      });
    }
    if (!rows.length) {
      toast('No student rows were detected. Try a clearer screenshot.');
      return;
    }
    studentOcrRows = rows;
    openModal('studentOcrModal');
    renderStudentOcrPreview();
  } catch (error) {
    console.error(error);
    toast(error instanceof Error ? `Could not read screenshot: ${error.message}` : 'Could not read the screenshot. Please try again.');
  }
}

function exportBackup() {
  const filename = `rangrasiya-backup-${today}.json`;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast(`Backup downloaded: ${filename}`);
}

async function importBackup(file) {
  if (file.size > 10_000_000) {
    toast('Backup file is too large.');
    return;
  }
  try {
    const imported = JSON.parse(await file.text());
    const collections = ['events', 'students', 'allocations', 'payments', 'expenses'];
    if (
      !imported ||
      typeof imported !== 'object' ||
      collections.some(collection => !Array.isArray(imported[collection]))
    ) {
      throw new Error('This file is not a valid Rangrasiya backup.');
    }
    if (!confirm('Replace all current data on this device and in shared storage with this backup?')) {
      return;
    }
    state = imported;
    dedupeNavratriEvents();
    save();
    render();
    toast('Backup restored to this device and shared storage.');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not restore this backup.');
  }
}

function addStudentOcrRows() {
  const seen = new Set(state.students.map(student => studentKey(student.name, student.mobile)));
  let added = 0,
    skipped = 0,
    invalid = 0;
  studentOcrRows.forEach((row, index) => {
    const nameInput = $(`[data-ocr-name="${index}"]`);
    const mobileInput = $(`[data-ocr-mobile="${index}"]`);
    const checkbox = $(`[data-ocr-select="${index}"]`);
    const name = cellText(nameInput?.value);
    const mobile = normalizeStudentMobile(mobileInput?.value);
    if (!checkbox?.checked) return;
    if (!name || mobile.length < 8 || mobile.length > 15) {
      invalid++;
      return;
    }
    const key = studentKey(name, mobile);
    if (seen.has(key)) {
      skipped++;
      return;
    }
    state.students.push({ id: uid('ST'), name, mobile });
    seen.add(key);
    added++;
  });
  if (added > 0) save();
  closeModals();
  render();
  toast(`${added} student profile(s) added from screenshot.${skipped ? ` ${skipped} duplicate(s) skipped.` : ''}${invalid ? ` ${invalid} invalid row(s) skipped.` : ''}`);
}

function importBulkWorkbook(file) {
  if (!window.XLSX) {
    toast('Excel importer is loading. Please retry in a moment.');
    return;
  }
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const book = XLSX.read(event.target.result, {
          type: 'array',
          cellDates: true,
        }),
        eventsSheet = book.Sheets.Events,
        passesSheet = book.Sheets['Students & Passes'];
      if (!eventsSheet || !passesSheet) {
        toast(
          'Use the supplied template with Events and Students & Passes sheets.'
        );
        return;
      }
      const eventRows = XLSX.utils.sheet_to_json(eventsSheet, {
          defval: '',
          raw: false,
        }),
        passRows = XLSX.utils.sheet_to_json(passesSheet, {
          defval: '',
          raw: false,
        });
      let addedEvents = 0,
        addedStudents = 0,
        issued = 0,
        skipped = 0,
        errors = [];
      eventRows.forEach((row, index) => {
        const name = cellText(field(row, 'Event Name')),
          dayMatch = cellText(field(row, 'Day')).match(/\d+/),
          day = dayMatch ? Number(dayMatch[0]) : 0,
          date = importDate(field(row, 'Date')),
          received = Number(field(row, 'Total Passes Received')),
          price = Number(field(row, 'Student Pass Price')),
          purchase = Number(field(row, 'Purchase Price'));
        if (!name && !day) return;
        if (!name || !day || !date || received < 0 || price < 0) {
          errors.push(`Events row ${index + 2}`);
          return;
        }
        if (
          state.events.some(
            e =>
              e.name.toLowerCase() === name.toLowerCase() &&
              Number(e.day) === day
          )
        ) {
          skipped++;
          return;
        }
        state.events.push({
          id: uid('EV'),
          name,
          day,
          date,
          artist: cellText(field(row, 'Artist')),
          received,
          price,
          purchasePrice: purchase || 0,
        });
        addedEvents++;
      });
      passRows.forEach((row, index) => {
        const name = cellText(field(row, 'Student Name')),
          mobile = cellText(field(row, 'Mobile Number')).replace(/\D/g, ''),
          eventName = cellText(field(row, 'Event Name')),
          quantity = Number(field(row, 'Pass Quantity')),
          paid = Number(field(row, 'Advance Amount')) || 0,
          mode =
            cellText(field(row, 'Payment Mode')) === 'Online'
              ? 'Online'
              : 'Cash',
          paymentDate = importDate(field(row, 'Payment Date')) || today,
          comp = ['yes', 'y', 'true'].includes(
            cellText(field(row, 'Complimentary')).toLowerCase()
          );
        if (!name && !mobile && !eventName) return;
        const eventRecord = state.events.find(
          e => e.name.toLowerCase() === eventName.toLowerCase()
        );
        if (!name || !mobile || !eventRecord || !quantity || quantity < 1) {
          errors.push(`Passes row ${index + 2}`);
          return;
        }
        if (eventRecord.received - eventIssued(eventRecord.id) < quantity) {
          errors.push(`Passes row ${index + 2}: insufficient passes`);
          return;
        }
        let student = state.students.find(
          s => s.mobile.replace(/\D/g, '') === mobile
        );
        if (!student) {
          student = { id: uid('ST'), name, mobile };
          state.students.push(student);
          addedStudents++;
        }
        let duplicate = state.allocations.find(
          a =>
            a.student === student.id &&
            a.event === eventRecord.id &&
            !a.handover
        );
        if (duplicate) {
          skipped++;
          return;
        }
        const due = comp ? 0 : quantity * Number(eventRecord.price);
        if (paid > due) {
          errors.push(`Passes row ${index + 2}: advance exceeds total`);
          return;
        }
        let allocation = {
          id: uid('AL'),
          student: student.id,
          event: eventRecord.id,
          quantity,
          complimentary: comp,
          issued: true,
          issuedDate: today,
          handover: false,
        };
        state.allocations.push(allocation);        if (paid > 0)
          state.payments.push({
            id: uid('PAY'),
            allocation: allocation.id,
            amount: paid,
            date: paymentDate,
            mode,
          });
        issued++;
      });
      save();
      render();
      const issueText = errors.length
        ? ` ${errors.length} row(s) need correction.`
        : '';
      toast(
        `${addedEvents} events, ${addedStudents} students and ${issued} passes imported.${skipped ? ` ${skipped} duplicate row(s) skipped.` : ''}${issueText}`
      );
      if (errors.length)
        console.warn('Bulk import rows needing correction:', errors);
    } catch (error) {
      console.error(error);
      toast(
        'Could not read this Excel file. Download and use the sample template.'
      );
    }
  };
  reader.readAsArrayBuffer(file);
}
async function qrImageForAllocation(allocation) {
  const holder = document.createElement('div');
  holder.style.cssText =
    'position:fixed;left:-10000px;top:-10000px;opacity:0;pointer-events:none';
  document.body.appendChild(holder);
  const payload = JSON.stringify({
    app: 'PassFlow',
    version: 2,
    allocationId: allocation.id,
    eventId: allocation.event,
    studentId: allocation.student,
  });
  new QRCode(holder, {
    text: payload,
    width: 260,
    height: 260,
    correctLevel: QRCode.CorrectLevel.H,
  });
  await new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
  const image =
    $('img', holder)?.src || $('canvas', holder)?.toDataURL('image/png');
  holder.remove();
  if (!image) throw new Error('QR image could not be created');
  return image;
}
async function generatePdf(ids, share = false) {
  if (!window.jspdf || !window.QRCode) {
    toast('QR/PDF library is still loading. Please retry.');
    return;
  }
  const allocations = ids
    .map(id => state.allocations.find(a => a.id === id))
    .filter(Boolean)
    .sort((a, b) =>
      (eventOf(a.event)?.date || '').localeCompare(eventOf(b.event)?.date || '')
    );
  if (!allocations.length) return;
  const { jsPDF } = window.jspdf,
    doc = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let i = 0; i < allocations.length; i++) {
    let a = allocations[i],
      s = studentOf(a.student) || {},
      e = eventOf(a.event) || {},
      img = await qrImageForAllocation(a);
    if (i) doc.addPage();
    doc.setFillColor(23, 35, 45);
    doc.rect(0, 0, 210, 38, 'F');
    doc.setTextColor(201, 250, 82);
    doc.setFontSize(11);
    doc.text('RANGRASIYA RAAS GARBA  /  EVENT ENTRY PASS', 16, 17);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(21);
    doc.text(e.name || 'Event pass', 16, 29);
    doc.setTextColor(23, 35, 45);
    doc.setFontSize(12);
    doc.text(`Day ${e.day || '—'} · ${dateFmt(e.date)}`, 16, 49);
    doc.setFontSize(17);
    doc.text(s.name || 'Student', 16, 64);
    doc.setFontSize(11);
    doc.setTextColor(90, 100, 105);
    doc.text(`Mobile: ${s.mobile || '—'}`, 16, 72);
    doc.text(`Pass quantity: ${a.quantity}`, 16, 80);
    doc.text(`Allocation ID: ${a.id}`, 16, 88);
    doc.text(
      a.complimentary ? 'COMPLIMENTARY PASS' : 'VALID FOR ENTRY',
      16,
      96
    );
    doc.addImage(img, 'PNG', 123, 48, 66, 66);
    doc.setDrawColor(215, 215, 210);
    doc.line(16, 111, 194, 111);
    doc.setTextColor(90, 100, 105);
    doc.setFontSize(9);
    doc.text(
      'Scan at the gate. This QR is unique to this student and event.',
      16,
      119
    );
    doc.text(`Issued: ${dateFmt(a.issuedDate || today)}`, 16, 126);
  }
  const studentFileName = (studentOf(allocations[0].student)?.name || 'Student')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ') || 'Student';
  const filename = `${studentFileName}.pdf`;
  doc.save(filename);
  if (share) {
    const student = studentOf(allocations[0].student);
    const message = `Hi ${student?.name || ''}, your Rangrasiya Raas Garba QR passes are ready. I will attach the PDF here.`;
    $('#whatsappShareLink').href = waUrl(student, message);
    openModal('whatsappShareModal');
    toast(`PDF download started: ${filename}. Open WhatsApp after it finishes.`);
  } else toast('QR PDF downloaded.');
}
function issue(a) {
  a.issued = true;
  a.issuedDate = today;
  save();
  render();
  generatePdf([a.id], false);
  toast('Pass issued. QR PDF generated.');
}
function paymentModal(id) {
  let a = state.allocations.find(a => a.id === id),
    s = studentOf(a.student),
    e = eventOf(a.event),
    due = allocationDue(a),
    paid = allocationPaid(id);
  $('#paymentForm [name=allocation]').value = id;
  $('#paymentForm [name=amount]').max = Math.max(0, due - paid);
  $('#paymentForm .payment-context').innerHTML =
    `<b>${esc(s.name)}</b> · ${esc(e.name)}<br>Pending: <b>${money(Math.max(0, due - paid))}</b>`;
  $('#paymentForm [name=date]').value = today;
  openModal('paymentModal');
}
function studentHistory(id) {
  let s = studentOf(id),
    rows = state.allocations
      .filter(a => a.student === id)
      .map(a => {
        let e = eventOf(a.event);
        return `${e?.name || '—'} (${dateFmt(e?.date)}) · ${allocationStatus(a)} · ${money(allocationPaid(a.id))}/${money(allocationDue(a))}`;
      })
      .join('\n');
  alert(`${s.name}\n\nEvent history:\n${rows || 'No pass allocations.'}`);
}
function updateScanCountSummary() {
  const issued = state.allocations.filter(allocation => allocation.issued),
    total = issued.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0),
    scanned = issued.filter(allocation => allocation.handover).reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
  const summary = $('#scanCountSummary');
  if (summary) summary.textContent = `Scanned passes: ${scanned} / ${total} · Remaining passes: ${Math.max(0, total - scanned)}`;
}
async function startScanner() {
  openModal('scannerModal');
  updateScanCountSummary();
  $('#scanResult').textContent = 'Opening camera…';
  try {
    if (
      !scanStream ||
      !scanStream.getTracks().some(track => track.readyState === 'live')
    )
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
    scanStream.getTracks().forEach(track => (track.enabled = true));
    let v = $('#scannerVideo');
    v.srcObject = scanStream;
    await v.play();
    scanLoop = requestAnimationFrame(readQR);
    $('#scanResult').textContent = 'Point your camera at a PassFlow QR code.';
  } catch (e) {
    scanStream = null;
    $('#scanResult').textContent =
      'Camera permission was not allowed. Please allow it, then open Scan again.';
  }
}
function stopScanner(releaseCamera = false) {
  if (scanLoop) cancelAnimationFrame(scanLoop);
  scanLoop = null;
  let v = $('#scannerVideo');
  if (v) {
    v.pause();
    v.srcObject = null;
  }
  if (!scanStream) return;
  if (releaseCamera) {
    scanStream.getTracks().forEach(track => track.stop());
    scanStream = null;
  } else scanStream.getTracks().forEach(track => (track.enabled = false));
}
function readQR() {
  let v = $('#scannerVideo'),
    c = $('#scannerCanvas');
  if (v?.readyState === v.HAVE_ENOUGH_DATA) {
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    let ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0);
    let code = window.jsQR?.(
      ctx.getImageData(0, 0, c.width, c.height).data,
      c.width,
      c.height
    );
    if (code) {
      try {
        let data = JSON.parse(code.data);
        if (data.app === 'PassFlow') {
          verifyHandover(data);
          return;
        }
      } catch {}
    }
  }
  scanLoop = requestAnimationFrame(readQR);
}
function verifyHandover(qr) {
  let id = typeof qr === 'string' ? qr : qr.allocationId || qr.id,
    a = state.allocations.find(a => a.id === id),
    s = studentOf(a?.student),
    e = eventOf(a?.event);
  if (
    !a ||
    (qr.eventId && a.event !== qr.eventId) ||
    (qr.studentId && a.student !== qr.studentId)
  ) {
    $('#scanResult').textContent =
      'Invalid QR: no matching event allocation found.';
    return;
  }
  if (e?.date && e.date !== today) {
    $('#scanResult').innerHTML = `<b>INVALID — WRONG DATE</b><br>This pass is valid only on ${dateFmt(e.date)}.`;
    return;
  }
  if (!a.issued) {
    $('#scanResult').textContent =
      'This allocation is pending issue and cannot be handed over.';
    return;
  }
  if (a.handover) {
    $('#scanResult').innerHTML =
      `<b>Already handed over</b><br>${esc(s.name)} · ${esc(e.name)}<br>${dateFmt(a.handoverDate)} · ${esc(a.id)}`;
    return;
  }
  a.handover = true;
  a.handoverDate = today;
  save();
  $('#scanResult').innerHTML =
    `<b>VALID PASS ✓</b><br>${Number(a.quantity)} pass(es) scanned successfully<br>${esc(s.name)} · Day ${esc(e.day || '—')} · ${dateFmt(e.date)}<br><small>${esc(a.id)}</small>`;
  updateScanCountSummary();
  render();
  stopScanner();
}
function exportCSV() {
  let head = [
    'Event',
    'Day',
    'Date',
    'Received',
    'Issued',
    'Remaining',
    'Sales value',
    'Purchase cost',
  ];
  let rows = state.events.map(e => {
    let q = eventIssued(e.id);
    return [
      e.name,
      e.day,
      e.date,
      e.received,
      q,
      e.received - q,
      q * e.price,
      q * (e.purchasePrice || 0),
    ];
  });
  let csv = [head, ...rows]
    .map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  let a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'Rangrasiya-Pass-Control-report.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportReportPdf() {
  if (!window.jspdf) {
    toast('PDF library is loading; retry in a moment.');
    return;
  }
  let { jsPDF } = window.jspdf,
    doc = new jsPDF();
  doc.setFontSize(21);
  doc.text('Rangrasiya Raas Garba report', 16, 20);
  doc.setFontSize(11);
  let y = 35;
  state.events
    .sort((a, b) => a.day - b.day)
    .forEach(e => {
      let q = eventIssued(e.id);
      doc.text(
        `${e.day} · ${e.name} — ${q}/${e.received} issued · Sales ${money(q * e.price)}`,
        16,
        y
      );
      y += 9;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
    });
  doc.save('Rangrasiya-Pass-Control-report.pdf');
}
document.addEventListener('click', e => {
  let b = e.target.closest('button,a');
  if (!b) return;
  if (b.dataset.view) {
    currentView = b.dataset.view;
    $$('.nav').forEach(x => x.classList.toggle('active', x === b));
    render();
  }
  if (b.dataset.viewGo) {
    currentView = b.dataset.viewGo;
    $$('.nav').forEach(x =>
      x.classList.toggle('active', x.dataset.view === currentView)
    );
    render();
  }
  if (b.dataset.open) {
    if (b.dataset.open === 'eventModal') $('#eventForm').reset();
    if (b.dataset.open === 'studentModal') $('#studentForm').reset();
    openModal(b.dataset.open);
  }
  if (b.classList.contains('close') || b.id === 'modalBackdrop') closeModals();
  if (b.dataset.editEvent) edit('event', b.dataset.editEvent);
  if (b.dataset.editStudent) edit('student', b.dataset.editStudent);
  if (b.dataset.editExpense) edit('expense', b.dataset.editExpense);
  if (b.dataset.deleteEvent) remove('events', b.dataset.deleteEvent);
  if (b.dataset.deleteAllocation) deleteAllocation(b.dataset.deleteAllocation);
  if (b.dataset.deleteStudent) remove('students', b.dataset.deleteStudent);
  if (b.dataset.deleteExpense) remove('expenses', b.dataset.deleteExpense);
  if (b.dataset.issue)
    issue(state.allocations.find(a => a.id === b.dataset.issue));
  if (b.dataset.issueStudent) {
    allocationStudentId = b.dataset.issueStudent;
    openModal('allocationModal');
  }
  if (b.dataset.payment) paymentModal(b.dataset.payment);
  if (b.dataset.pdf) generatePdf([b.dataset.pdf], true);
  if (b.dataset.whatsapp) {
    const student = studentOf(b.dataset.whatsapp);
    const mobile = whatsappNumber(student);
    if (mobile.length < 8 || mobile.length > 15) {
      toast('Add a valid mobile number to this student before sharing a QR PDF.');
      return;
    }
    let ids = state.allocations
      .filter(a => a.student === b.dataset.whatsapp && a.issued)
      .map(a => a.id);
    if (!ids.length) toast('Issue at least one pass before sharing a QR PDF.');
    else generatePdf(ids, true);
  }
  if (b.dataset.studentHistory) studentHistory(b.dataset.studentHistory);
  if (b.dataset.action === 'scan') startScanner();
  if (b.dataset.action === 'bulk-allocate') { prepareBulkAllocation(); openModal('bulkAllocationModal'); }
  if (b.id === 'bulkDeselectAll') { bulkSelectedStudentIds = new Set(); renderBulkStudents(); }
  if (b.dataset.action === 'bulk-import') $('#bulkFile').click();
  if (b.dataset.action === 'export-backup') exportBackup();
  if (b.dataset.action === 'import-backup') $('#backupFile').click();
  if (b.dataset.action === 'student-import') openModal('studentImportModal');
  if (b.dataset.action === 'student-import-excel') $('#studentFile').click();
  if (b.dataset.action === 'student-import-screenshot') $('#studentScreenshotFile').click();
  if (b.dataset.action === 'student-import-add-manual') { closeModals(); $('#studentForm').reset(); openModal('studentModal'); }
  if (b.dataset.action === 'student-ocr-add') addStudentOcrRows();
  if (b.id === 'stopScanner') stopScanner(true);
  if (b.dataset.export === 'csv') exportCSV();
  if (b.dataset.export === 'pdf') exportReportPdf();
});
function edit(type, id) {
  let obj = state[`${type}s`].find(x => x.id === id),
    form = $(`#${type}Form`);
  form.reset();
  Object.entries(obj).forEach(([k, v]) => {
    if (form.elements[k]) form.elements[k].value = v;
  });
  if (type === 'student' && form.elements.issueNow) {
    form.elements.issueNow.checked = state.allocations.some(a => a.student === id);
  }
  openModal(`${type}Modal`);
}
function deleteAllocation(id) {
  const allocation = state.allocations.find(item => item.id === id);
  if (!allocation) return;
  const event = eventOf(allocation.event);
  const student = studentOf(allocation.student);
  const paid = allocationPaid(id);
  const details = `Delete this pass allocation for ${student?.name || 'this student'} — Day ${event?.day || '—'} (${event?.name || 'event'})? This also removes its ${money(paid)} linked payment record(s). Other passes and payments will remain.`;
  if (!confirm(details)) return;
  state.allocations = state.allocations.filter(item => item.id !== id);
  state.payments = state.payments.filter(payment => payment.allocation !== id);
  save();
  render();
  toast('Pass allocation and its linked payments deleted.');
}
function remove(collection, id) {
  let name = collection.slice(0, -1);
  if (collection === 'students') {
    const student = studentOf(id);
    const allocations = state.allocations.filter(a => a.student === id);
    const allocationIds = new Set(allocations.map(a => a.id));
    const linkedPayments = state.payments.filter(p => allocationIds.has(p.allocation));
    if (!confirm(`Delete student ${student?.name || ''}? This will also delete ${allocations.length} allocated pass(es) and ${linkedPayments.length} linked payment record(s). Event inventory will be restored.`))
      return;
    state.students = state.students.filter(x => x.id !== id);
    state.allocations = state.allocations.filter(a => a.student !== id);
    state.payments = state.payments.filter(p => !allocationIds.has(p.allocation));
    save();
    render();
    toast(`Student deleted with ${allocations.length} pass allocation(s) and ${linkedPayments.length} linked payment record(s).`);
    return;
  }
  if (
    !confirm(`Delete this ${name}? Existing records are kept where possible.`)
  )
    return;
  state[collection] = state[collection].filter(x => x.id !== id);
  save();
  render();
}
$('#eventForm').addEventListener('submit', e => {
  e.preventDefault();
  let d = Object.fromEntries(new FormData(e.target));
  d.day = String(d.day || '').trim();
  d.price = Number(d.price);
  d.purchasePrice = Number(d.purchasePrice);
  d.received = Number(d.received);
  let old = state.events.find(x => x.id === d.id);
  let duplicateDay = state.events.find(x => String(x.day).trim().toLowerCase() === d.day.toLowerCase() && x.id !== d.id);
  if (duplicateDay) {
    toast(`${d.day} already has an event label. Use a different label or edit that event.`);
    return;
  }
  if (old) Object.assign(old, d);
  else state.events.push({ ...d, id: uid('EV') });
  save();
  closeModals();
  render();
  toast('Event saved.');
});
$('#studentForm').elements.issueNow.addEventListener('change', syncStudentIssueMode);
$('#studentForm').addEventListener('input', e => {
  if (e.target.name === 'studentPaidAmount') e.target.dataset.edited = 'true';
  if (e.target.name === 'studentEventQuantity') e.target.dataset.custom = 'true';
  if (e.target.name === 'studentQuantity') syncCommonStudentQuantities(true);
  if (e.target.closest('.issue-on-create')) updateStudentIssueTotal();
});
$('#studentForm').addEventListener('change', e => {
  if (e.target.id === 'studentSelectAllEvents') {
    $$('#studentIssueEvents input[type="checkbox"][name="studentEvents"]:not(:disabled)').forEach(
      input => (input.checked = e.target.checked)
    );
    syncCommonStudentQuantities(true);
  }
  if (e.target.name === 'studentEvents') {
    if (e.target.checked) {
      const quantityInput = $(`#studentIssueEvents input[name="studentEventQuantity"][data-event-id="${e.target.value}"]`);
      if (quantityInput && quantityInput.dataset.custom !== 'true' && quantityInput.dataset.existing !== 'true') {
        quantityInput.value = String(Math.max(1, Number($('#studentForm [name=studentQuantity]').value) || 1));
      }
    }
    const available = $$('#studentIssueEvents input[type="checkbox"][name="studentEvents"]:not(:disabled)'),
      selected = available.filter(input => input.checked),
      selectAll = $('#studentSelectAllEvents');
    if (selectAll) {
      selectAll.checked =
        available.length > 0 && selected.length === available.length;
      selectAll.indeterminate =
        selected.length > 0 && selected.length < available.length;
    }
  }
  if (e.target.closest('.issue-on-create')) updateStudentIssueTotal();
});
$('#studentForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target),
    d = Object.fromEntries(fd),
    old = state.students.find(x => x.id === d.id),
    studentId = old?.id || uid('ST'),
    commonQuantity = Number(fd.get('studentQuantity')) || 1,
    selectedRows = selectedEventQuantities('#studentIssueEvents', 'studentEvents', 'studentEventQuantity', commonQuantity),
    complimentary = fd.get('studentComplimentary') === 'on',
    customRaw = fd.get('studentCustomTotal'),
    customTotal = customRaw === '' ? null : Number(customRaw),
    paid = Number(fd.get('studentPaidAmount')) || 0,
    issueNow = e.target.elements.issueNow.checked;
  if (!issueNow) {
    if (old) Object.assign(old, { name: d.name, mobile: d.mobile });
    else state.students.push({ id: studentId, name: d.name, mobile: d.mobile });
    save();
    closeModals();
    render();
    toast(old ? 'Student details updated.' : 'Student profile saved. You can issue passes later.');
    return;
  }
  if (!selectedRows.length) {
    toast('Select at least one event pass to issue.');
    return;
  }
  if (customTotal !== null && (!Number.isFinite(customTotal) || customTotal < 0)) {
    toast('Custom total must be a valid non-negative amount.');
    return;
  }
  const plans = selectedRows.map(row => ({
    ...row,
    existing: state.allocations.find(a => a.student === studentId && a.event === row.id),
    event: eventOf(row.id),
  }));
  for (const plan of plans) {
    if (!Number.isInteger(plan.quantity) || plan.quantity < 1) {
      toast('Each selected day must have a whole-number quantity of at least 1.');
      return;
    }
    if (!plan.event) {
      toast('A selected event could not be found. Please refresh and try again.');
      return;
    }
    if (plan.existing) {
      const increase = plan.quantity - Number(plan.existing.quantity || 0);
      if (increase < 0) {
        toast('Existing pass quantities can only be increased here. No passes were changed.');
        return;
      }
      if (increase > 0 && plan.existing.handover) {
        toast(`Day ${plan.event.day} was already scanned. Its quantity cannot be changed after handover.`);
        return;
      }
      if (increase > plan.event.received - eventIssued(plan.event.id)) {
        toast(`${plan.event.name} does not have enough remaining passes for the increase.`);
        return;
      }
      if (increase > 0 && plan.existing.complimentary && increase > eventComplimentaryRemaining(plan.event.id)) {
        toast(`${plan.event.name} does not have enough complimentary passes remaining.`);
        return;
      }
    } else {
      if (plan.quantity > plan.event.received - eventIssued(plan.event.id)) {
        toast(`${plan.event.name} does not have enough remaining passes.`);
        return;
      }
      if (complimentary && plan.quantity > eventComplimentaryRemaining(plan.event.id)) {
        toast(`${plan.event.name} does not have enough complimentary passes remaining.`);
        return;
      }
    }
  }
  const newPlans = plans.filter(plan => !plan.existing),
    standardNewTotal = newPlans.reduce((sum, plan) => sum + Number(plan.event.price || 0) * plan.quantity, 0),
    newTotal = customTotal === null ? standardNewTotal : customTotal,
    increaseTotal = plans.reduce((sum, plan) => sum + (!plan.existing || plan.existing.complimentary ? 0 : Math.max(0, plan.quantity - Number(plan.existing.quantity || 0)) * Number(plan.event.price || 0)), 0),
    totalChange = newTotal + increaseTotal;
  if (customTotal !== null && !newPlans.length && customTotal > 0) {
    toast('Custom total applies only to newly selected days. Existing day quantity increases use the event price.');
    return;
  }
  if (!complimentary && (!Number.isFinite(paid) || paid < 0 || paid > totalChange)) {
    toast('Advance amount cannot exceed the value of the new or increased passes.');
    return;
  }
  if (old) Object.assign(old, { name: d.name, mobile: d.mobile });
  else state.students.push({ id: studentId, name: d.name, mobile: d.mobile });
  const created = [],
    changedAllocations = [],
    saleAmounts = new Map();
  if (newPlans.length && customTotal === null) {
    newPlans.forEach(plan => saleAmounts.set(plan.id, Number(plan.event.price || 0) * plan.quantity));
  } else if (newPlans.length) {
    let remainingCustom = newTotal;
    newPlans.forEach((plan, index) => {
      const amount = index === newPlans.length - 1
        ? remainingCustom
        : Math.round(newTotal * (Number(plan.event.price || 0) * plan.quantity) / (standardNewTotal || 1));
      remainingCustom -= amount;
      saleAmounts.set(plan.id, amount);
    });
  }
  for (const plan of plans) {
    if (plan.existing) {
      const increase = plan.quantity - Number(plan.existing.quantity || 0);
      if (increase > 0) {
        if (!plan.existing.complimentary) {
          plan.existing.saleAmount = Number(plan.existing.saleAmount ?? Number(plan.existing.quantity) * Number(plan.event.price || 0)) + increase * Number(plan.event.price || 0);
        }
        plan.existing.quantity = plan.quantity;
        changedAllocations.push(plan.existing.id);
      }
      continue;
    }
    const allocation = {
      id: uid('AL'),
      student: studentId,
      event: plan.id,
      quantity: plan.quantity,
      studentPrice: Number(plan.event.price || 0),
      saleAmount: saleAmounts.get(plan.id) ?? Number(plan.event.price || 0) * plan.quantity,
      complimentary,
      issued: true,
      issuedDate: today,
      handover: false,
    };
    state.allocations.push(allocation);
    created.push(allocation.id);
    changedAllocations.push(allocation.id);
  }
  let remaining = complimentary ? 0 : paid;
  for (const id of changedAllocations) {
    const allocation = state.allocations.find(item => item.id === id),
      availableDue = Math.max(0, allocationDue(allocation) - allocationPaid(id)),
      amount = Math.min(remaining, availableDue);
    if (amount > 0) {
      state.payments.push({
        id: uid('PAY'),
        allocation: id,
        amount,
        date: fd.get('studentPaymentDate') || today,
        mode: fd.get('studentPaymentMode'),
      });
      remaining -= amount;
    }
  }
  save();
  closeModals();
  render();
  if (changedAllocations.length) {
    const allIssuedIds = state.allocations.filter(a => a.student === studentId && a.issued).map(a => a.id);
    generatePdf(allIssuedIds, false);
  }
  const quantityIncreases = plans.filter(plan => plan.existing && plan.quantity > Number(plan.existing.quantity || 0)).length;
  toast(old
    ? `Student updated; ${created.length} new day allocation(s) and ${quantityIncreases} quantity increase(s) saved.`
    : `Student saved, ${money(complimentary ? 0 : paid)} recorded and QR PDF issued.`);
});
$('#expenseForm').addEventListener('submit', e => {
  e.preventDefault();
  let d = Object.fromEntries(new FormData(e.target));
  let old = state.expenses.find(x => x.id === d.id);
  if (old) Object.assign(old, d);
  else state.expenses.push({ ...d, id: uid('EX') });
  save();
  closeModals();
  render();
  toast('Expense saved.');
});
$('#paymentForm').addEventListener('submit', e => {
  e.preventDefault();
  let d = Object.fromEntries(new FormData(e.target)),
    a = state.allocations.find(a => a.id === d.allocation),
    due = allocationDue(a),
    paid = allocationPaid(a.id);
  if (+d.amount > due - paid) {
    toast('Amount cannot exceed the pending balance.');
    return;
  }
  state.payments.push({ ...d, id: uid('PAY') });
  save();
  closeModals();
  render();
  toast('Payment recorded.');
});
$('#allocationForm').addEventListener('input', e => {
  if (e.target.name === 'paidAmount') e.target.dataset.edited = 'true';
  updateAllocationTotal();
});
$('#allocationForm').addEventListener('change', updateAllocationTotal);
$('#allocationForm').addEventListener('submit', e => {
  e.preventDefault();
  let fd = new FormData(e.target),
    student = fd.get('student'),
    quantity = +fd.get('quantity'),
    events = fd.getAll('events'),
    complimentary = fd.get('complimentary') === 'on',
    customRaw = fd.get('customTotal'),
    customTotal = customRaw === '' ? null : +customRaw,
    standardTotal = events.reduce(
      (n, id) => n + Number(eventOf(id).price) * quantity,
      0
    ),
    total = customTotal ?? standardTotal,
    paidAmount = +fd.get('paidAmount');
  if (!student || !events.length) {
    toast('Select a student and at least one event.');
    return;
  }
  if (customTotal !== null && customTotal < 0) {
    toast('Custom total cannot be negative.');
    return;
  }
  if (!complimentary && (paidAmount < 0 || paidAmount > total)) {
    toast('Advance amount must be between ₹0 and the total pass value.');
    return;
  }
  let bad = events.find(
    id => eventOf(id).received - eventIssued(id) < quantity
  );
  if (bad) {
    toast(`${eventOf(bad).name} does not have enough remaining passes.`);
    return;
  }
  if (complimentary) {
    const freeBad = events.find(id => eventComplimentaryRemaining(id) < quantity);
    if (freeBad) { toast(`${eventOf(freeBad).name} does not have enough complimentary passes remaining.`); return; }
  }
  let existingEvent = events.find(ev =>
    state.allocations.some(
      a => a.student === student && a.event === ev && !a.handover
    )
  );
  if (existingEvent) {
    toast(
      `${eventOf(existingEvent).name} already has an active allocation for this student.`
    );
    return;
  }
  let created = [],
    saleAmounts = new Map(
      splitCustomTotal(events, quantity, customTotal ?? standardTotal).map(
        item => [item.id, item.amount]
      )
    );
  for (let ev of events) {
    let a = {
      id: uid('AL'),
      student,
      event: ev,
      quantity,
      studentPrice: Number(eventOf(ev).price),
      saleAmount: saleAmounts.get(ev),
      complimentary,
      issued: true,
      issuedDate: today,
      handover: false,
    };
    state.allocations.push(a);
    created.push(a.id);
  }
  let remainingPaid = paidAmount;
  for (let id of created) {
    let a = state.allocations.find(x => x.id === id),
      amount = Math.min(remainingPaid, allocationDue(a));
    if (amount > 0) {
      state.payments.push({
        id: uid('PAY'),
        allocation: id,
        amount,
        date: fd.get('paymentDate') || today,
        mode: fd.get('paymentMode'),
      });
      remainingPaid -= amount;
    }
  }
  save();
  closeModals();
  render();
  generatePdf(created, false);
  toast(
    `${created.length} pass allocation(s) issued; ${money(paidAmount)} advance recorded.`
  );
});
document.addEventListener('input', e => {
  if (e.target.id === 'studentSearch') {
    studentSearchQuery = e.target.value;
    applyStudentSearch();
  }
});
document.addEventListener('change', e => {
  const map = {
    reportEvent: 'event',
    reportStudent: 'student',
    reportFrom: 'from',
    reportTo: 'to',
  };
  if (map[e.target.id]) {
    reportFilters[map[e.target.id]] = e.target.value;
    render();
  }
});
document.addEventListener('change', e => {
  if (e.target.name === 'bulkStudents') {
    if (e.target.checked) bulkSelectedStudentIds.add(e.target.value);
    else bulkSelectedStudentIds.delete(e.target.value);
    updateBulkAllocationSummary();
  }
  if (e.target.id === 'bulkSelectAll') {
    const visibleBoxes = $('#bulkStudentList input[name=bulkStudents]:not(:disabled)');
    visibleBoxes.forEach(input => {
      input.checked = e.target.checked;
      if (e.target.checked) bulkSelectedStudentIds.add(input.value);
      else bulkSelectedStudentIds.delete(input.value);
    });
    updateBulkAllocationSummary();
  }
  if (e.target.id === 'bulkEvent') {
    bulkSelectedStudentIds = new Set();
    renderBulkStudents();
  }
  if (e.target.id === 'bulkStudentSearch') renderBulkStudents();
  if (e.target.name === 'quantity' && e.target.closest('#bulkAllocationForm')) updateBulkAllocationSummary();
  if (e.target.name === 'complimentary' && e.target.closest('#bulkAllocationForm')) updateBulkAllocationSummary();
});
document.addEventListener('input', e => {
  if (e.target.id === 'bulkStudentSearch') renderBulkStudents();
  if (e.target.name === 'quantity' && e.target.closest('#bulkAllocationForm')) updateBulkAllocationSummary();
});

document.addEventListener('submit', e => {
  if (e.target.id === 'bulkAllocationForm') submitBulkAllocation(e);
});

$('#bulkFile').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) importBulkWorkbook(file);
  e.target.value = '';
});
$('#studentFile').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) importStudentsWorkbook(file);
  e.target.value = '';
});
$('#studentScreenshotFile').addEventListener('change', e => {
  const files = e.target.files;
  if (files?.length) importStudentScreenshots(files);
  e.target.value = '';
});
$('#backupFile').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) importBackup(file);
  e.target.value = '';
});
document.addEventListener('input', e => {
  if (e.target.matches('[data-ocr-name], [data-ocr-mobile]')) updateStudentOcrSummary();
});
document.addEventListener('click', e => {
  if (e.target.closest('[data-clear-report]')) {
    reportFilters = { event: '', student: '', from: '', to: '' };
    render();
  }
});
$('#seedBtn').addEventListener('click', () => {
  if (
    state.events.length ||
    !confirm('Load sample data? It will be added to current records.')
  )
    return;
  state.events = [
    {
      id: 'EV-1',
      name: 'Opening Garba',
      artist: 'Aditi Rao',
      day: 1,
      date: '2026-10-03',
      received: 200,
      price: 299,
      purchasePrice: 170,
    },
    {
      id: 'EV-2',
      name: 'Dandiya Beats',
      artist: 'The Rhythm Crew',
      day: 2,
      date: '2026-10-04',
      received: 200,
      price: 349,
      purchasePrice: 200,
    },
  ];
  state.students = [
    { id: 'ST-1', name: 'Riya Shah', mobile: '9876543210' },
    { id: 'ST-2', name: 'Dev Patel', mobile: '9898989898' },
  ];
  save();
  render();
  toast('Sample events and students loaded.');
});
bootstrapSharedState();
