import { vault } from './vault.js';
import {
  defaultData, uid, TARGET_GROUPS, DEFAULT_ACCOUNT_TYPES, toDisplay, fromInput, fmtG, status, STATUS_LABEL,
  glucoseStats, fmtMoney, accountBalance, totalsByCurrency, dayKey, monthKey, localInputValue, suggestReadingType,
} from './model.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appEl = $('#app');

let D = null; // decrypted data (memory only)
const ui = {
  gPeriod: 14, gType: 'all', gLimit: 40,
  mMonth: monthKey(new Date()), mKind: 'all', mQuery: '',
  rMode: 'day', rDay: dayKey(new Date()), rMonth: monthKey(new Date()),
};
let charts = [];

// ---------------- Persistence ----------------
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => vault.save(D).catch((e) => toast('Save failed: ' + e.message)), 150);
}
function commit() { persist(); render(); }

// ---------------- Toast & sheet ----------------
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
function openSheet(html, mount) {
  $('#sheet').innerHTML = `<div class="grab"></div>${html}`;
  $('#sheet-wrap').classList.add('open');
  $('#sheet').scrollTop = 0;
  mount?.($('#sheet'));
}
function closeSheet() { $('#sheet-wrap').classList.remove('open'); $('#sheet').innerHTML = ''; }
$('#sheet-bg').addEventListener('click', closeSheet);
function confirmSheet(title, body, okLabel, onOk, danger = true) {
  openSheet(`<h3>${esc(title)}</h3><p class="muted">${body}</p>
    <div class="btns"><button class="btn" data-x="cancel">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok">${esc(okLabel)}</button></div>`,
  (s) => {
    $('[data-x=cancel]', s).onclick = closeSheet;
    $('[data-x=ok]', s).onclick = async () => { await onOk(); closeSheet(); };
  });
}

// ---------------- Helpers ----------------
const unit = () => D.settings.glucoseUnit;
const rType = (id) => D.readingTypes.find((t) => t.id === id) || { name: 'Reading', icon: '🩸', group: 'other' };
const cat = (id) => D.categories.find((c) => c.id === id) || { name: 'Uncategorized', icon: '❔', color: '#999' };
const acct = (id) => D.accounts.find((a) => a.id === id);
const curOf = (t) => acct(t.accountId)?.currency || D.settings.currency;
const timeStr = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(key) {
  const today = dayKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (key === today) return 'Today';
  if (key === dayKey(y)) return 'Yesterday';
  return new Date(key + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: key.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
}
const monthLabel = (mk) => new Date(mk + '-15T12:00').toLocaleDateString([], { month: 'long', year: 'numeric' });
function shiftDay(key, n) { const d = new Date(key + 'T12:00'); d.setDate(d.getDate() + n); return dayKey(d); }
function shiftMonth(mk, n) { const d = new Date(mk + '-15T12:00'); d.setMonth(d.getMonth() + n); return monthKey(d); }
function groupBy(arr, fn) { const m = new Map(); for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
const sortDesc = (a, b) => new Date(b.t) - new Date(a.t);
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }
function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function currencyList() {
  try { return Intl.supportedValuesOf('currency'); } catch { return ['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED', 'KWD', 'QAR', 'JOD', 'MAD', 'TRY', 'INR']; }
}
function currencyOptions(sel) {
  const pop = ['EGP', 'SAR', 'AED', 'USD', 'EUR', 'GBP', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'MAD', 'TND', 'DZD', 'TRY'];
  const name = (c) => { try { return new Intl.DisplayNames([navigator.language, 'en'], { type: 'currency' }).of(c); } catch { return c; } };
  const all = currencyList().filter((c) => !pop.includes(c));
  return `<optgroup label="Common">${pop.map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c} · ${esc(name(c))}</option>`).join('')}</optgroup>
    <optgroup label="All">${all.map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c} · ${esc(name(c))}</option>`).join('')}</optgroup>`;
}
function guessCurrency() {
  const region = (navigator.language.split('-')[1] || '').toUpperCase();
  const m = { EG: 'EGP', SA: 'SAR', AE: 'AED', KW: 'KWD', QA: 'QAR', BH: 'BHD', OM: 'OMR', JO: 'JOD', MA: 'MAD', TN: 'TND', DZ: 'DZD', TR: 'TRY', GB: 'GBP', US: 'USD', IN: 'INR', PK: 'PKR' };
  return m[region] || 'EGP';
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const ICONS = {
  finger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 11v4.5a6 6 0 0 1-1.2 3.6"/><path d="M8.5 12a3.5 3.5 0 1 1 7 0v2.5c0 2 .4 3.6 1 5"/><path d="M5.6 15.5c.3-1 .4-2.2.4-3.5a6 6 0 0 1 12 0v1"/><path d="M4 9a8.5 8.5 0 0 1 15-3.5"/><path d="M19.5 9.5c.3.8.5 1.6.5 2.5v1"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  eye: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};

// ================= AUTH SCREENS =================
function pwField(id, ph, auto) {
  return `<div class="pwwrap"><input class="input" id="${id}" type="password" placeholder="${ph}" autocomplete="${auto}" required>
    <button type="button" class="eye" data-eye="${id}" aria-label="Show password">${ICONS.eye}</button></div>`;
}
function bindEyes(root) {
  $$('[data-eye]', root).forEach((b) => b.onclick = () => { const i = $('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; });
}
function pwScore(p) {
  let s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

function renderSetup() {
  setChrome(false);
  appEl.innerHTML = `
  <div class="auth">
    <img class="logo" src="icons/icon.svg" alt="">
    <h1>Welcome</h1>
    <p class="lead">Track your glucose and money privately. Your data is encrypted and stays on this device.</p>
    <form id="setup" class="card" autocomplete="on">
      <label class="f"><span>Your name</span><input class="input" id="s-name" placeholder="e.g. Ahmed" autocomplete="name" required></label>
      <label class="f"><span>Username</span><input class="input" id="s-user" placeholder="Choose a username" autocomplete="username" autocapitalize="none" required></label>
      <label class="f"><span>Password (min 8 characters)</span>${pwField('s-pw', 'Create a password', 'new-password')}
        <div class="strength"><i id="s-str"></i></div></label>
      <label class="f"><span>Confirm password</span>${pwField('s-pw2', 'Repeat password', 'new-password')}</label>
      <div class="grid2">
        <label class="f"><span>Main currency</span><select class="input" id="s-cur">${currencyOptions(guessCurrency())}</select></label>
        <label class="f"><span>Glucose unit</span><select class="input" id="s-unit"><option>mg/dL</option><option>mmol/L</option></select></label>
      </div>
      <div class="notice warn small">⚠️ There is no "forgot password". If you forget it, the data can't be recovered, so keep a backup (Settings → Backup).</div>
      <div class="err" id="s-err"></div>
      <button class="btn primary block" id="s-go">Create my secure space</button>
    </form>
    <p class="center small muted" style="margin-top:4px">Already have a backup? <button class="link" id="s-restore">Restore it</button></p>
  </div>`;
  bindEyes(appEl);
  const colors = ['#d64545', '#d68a00', '#c9a227', '#1f9d6b', '#1f9d6b'];
  $('#s-pw').oninput = (e) => { const s = pwScore(e.target.value); const i = $('#s-str'); i.style.width = (s + 1) * 20 + '%'; i.style.background = colors[s]; };
  $('#s-restore').onclick = () => restoreFlow(true);
  $('#setup').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#s-name').value.trim(), user = $('#s-user').value.trim(), pw = $('#s-pw').value;
    const err = $('#s-err');
    if (!name || !user) return (err.textContent = 'Please fill in your name and username.');
    if (pw.length < 8) return (err.textContent = 'Password must be at least 8 characters.');
    if (pw !== $('#s-pw2').value) return (err.textContent = 'Passwords don\'t match.');
    const btn = $('#s-go'); btn.disabled = true; btn.textContent = 'Encrypting…';
    try {
      D = defaultData({ name, currency: $('#s-cur').value });
      D.settings.glucoseUnit = $('#s-unit').value;
      await vault.create(user, pw, D);
      startSession();
      location.hash = '#/home';
      if (await vault.passkeySupported()) offerPasskey();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Create my secure space'; }
  };
}

function offerPasskey() {
  openSheet(`<h3>Unlock with fingerprint?</h3>
    <div class="center" style="color:var(--primary)"><div style="width:64px;margin:0 auto 8px">${ICONS.finger}</div></div>
    <p class="muted">Use your fingerprint or Face ID to open the app quickly. Your password will still work too.</p>
    <div class="btns"><button class="btn" data-x="no">Not now</button><button class="btn primary" data-x="yes">Turn on</button></div>`,
  (s) => {
    $('[data-x=no]', s).onclick = closeSheet;
    $('[data-x=yes]', s).onclick = async () => {
      try { await vault.enablePasskey(); toast('Fingerprint unlock is on'); closeSheet(); render(); } catch (e) { toast(e.message); }
    };
  });
}

let failCount = 0;
async function renderLock() {
  setChrome(false);
  const m = vault.meta;
  const canFinger = !!m.passkey && await vault.passkeySupported();
  appEl.innerHTML = `
  <div class="auth">
    <img class="logo" src="icons/icon.svg" alt="">
    <h1>Welcome back</h1>
    <p class="lead">Unlock to see your data</p>
    ${canFinger ? `<button class="finger" id="l-finger">${ICONS.finger}Unlock with fingerprint / Face ID</button><div class="or">or use your password</div>` : ''}
    <form id="lock" class="card">
      <label class="f"><span>Username</span><input class="input" id="l-user" value="${esc(m.username)}" autocomplete="username" autocapitalize="none" required></label>
      <label class="f"><span>Password</span>${pwField('l-pw', 'Password', 'current-password')}</label>
      <div class="err" id="l-err"></div>
      <button class="btn primary block" id="l-go">Unlock</button>
    </form>
    <div class="lockline">${ICONS.lock} End-to-end encrypted on this device</div>
    <p class="center small" style="margin-top:22px"><button class="link" id="l-reset" style="color:var(--muted)">Forgot password? Reset this device</button></p>
  </div>`;
  bindEyes(appEl);
  if (!canFinger) $('#l-pw').focus();
  const finish = (data) => { D = migrate(data); failCount = 0; startSession(); if (!location.hash || location.hash === '#/lock') location.hash = '#/home'; render(); };
  $('#l-finger')?.addEventListener('click', async () => {
    try { finish(await vault.unlockPasskey()); } catch (e) { $('#l-err').textContent = e.name === 'NotAllowedError' ? 'Cancelled. Try again or use your password.' : e.message; }
  });
  $('#lock').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#l-go'); btn.disabled = true; btn.textContent = 'Unlocking…';
    try { finish(await vault.unlockPassword($('#l-user').value, $('#l-pw').value)); }
    catch (ex) {
      failCount++;
      $('#l-err').textContent = ex.message;
      const wait = failCount >= 3 ? Math.min(2 ** (failCount - 2), 60) : 0;
      if (wait) { btn.textContent = `Wait ${wait}s`; await new Promise((r) => setTimeout(r, wait * 1000)); }
      btn.disabled = false; btn.textContent = 'Unlock';
    }
  };
  $('#l-reset').onclick = () => confirmSheet('Reset this device?',
    'This permanently deletes all data stored in the app on this device. You can restore from a backup file afterwards if you have one and remember its password.',
    'Delete everything', async () => { await vault.wipe(); location.hash = ''; boot(); });
}

function migrate(data) {
  const base = defaultData({ name: data?.profile?.name || '', currency: data?.settings?.currency || 'EGP' });
  const d = { ...base, ...data, settings: { ...base.settings, ...(data?.settings || {}) } };
  d.settings.targets = { ...base.settings.targets, ...(d.settings.targets || {}) };
  return d;
}

// ---------------- Session / auto-lock ----------------
let lastActive = Date.now();
let hiddenAt = null;
function startSession() { lastActive = Date.now(); applyTheme(); }
function lockNow() {
  if (!vault.unlocked) return;
  clearTimeout(saveTimer);
  vault.save(D).finally(() => { vault.lock(); D = null; closeSheet(); destroyCharts(); render(); });
}
['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((ev) => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => {
  if (!vault.unlocked || !D) return;
  const mins = D.settings.autoLockMin;
  if (mins > 0 && Date.now() - lastActive > mins * 60000) lockNow();
}, 15000);
document.addEventListener('visibilitychange', () => {
  if (!vault.unlocked || !D) return;
  if (document.hidden) { hiddenAt = Date.now(); if (saveTimer) { clearTimeout(saveTimer); vault.save(D); } }
  else if (hiddenAt) {
    const mins = D.settings.autoLockMin;
    if (mins === 0 || (mins > 0 && Date.now() - hiddenAt > mins * 60000)) lockNow();
    hiddenAt = null;
  }
});

function applyTheme() {
  const t = D?.settings.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ================= ROUTER =================
function setChrome(tabs, active) {
  $('#tabbar').classList.toggle('hidden', !tabs);
  appEl.classList.toggle('no-tabs', !tabs);
  $$('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === active));
}
async function render() {
  destroyCharts();
  if (!vault.meta) return renderSetup();
  if (!vault.unlocked || !D) return renderLock();
  const [route, sub] = (location.hash.replace('#/', '') || 'home').split('/');
  const views = { home: viewHome, glucose: viewGlucose, money: viewMoney, reports: viewReports, settings: viewSettings };
  const view = views[route] || viewHome;
  setChrome(true, route === 'settings' ? '' : route);
  view(sub);
  window.scrollTo?.(0, 0);
}
addEventListener('hashchange', render);
$('#fab').onclick = () => quickAdd();

function header(title, sub, right = '') {
  return `<header class="top"><div class="grow"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</header>`;
}
const gearBtn = `<a class="icon-btn" href="#/settings" aria-label="Settings" style="text-decoration:none">⚙️</a>`;
const lockBtn = `<button class="icon-btn" id="lock-btn" aria-label="Lock">🔒</button>`;
function bindLockBtn() { $('#lock-btn')?.addEventListener('click', lockNow); }

// ================= HOME =================
function viewHome() {
  const u = unit();
  const readings = [...D.readings].sort(sortDesc);
  const last = readings[0];
  const today = dayKey(new Date());
  const todayR = readings.filter((r) => dayKey(r.t) === today);
  const todayT = D.txns.filter((t) => dayKey(t.t) === today);
  const tot = totalsByCurrency(todayT, D.accounts);
  const week = readings.filter((r) => Date.now() - new Date(r.t) < 7 * 864e5);
  const ws = glucoseStats(week, D);
  const mainCur = D.settings.currency;
  const cur = tot[mainCur] || { income: 0, expense: 0 };
  const otherCurs = Object.keys(tot).filter((c) => c !== mainCur);

  appEl.innerHTML = `
  ${header(`${greet()}, ${esc(D.profile.name.split(' ')[0] || 'there')}`, new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }), `<div class="row">${lockBtn}${gearBtn}</div>`)}

  <div class="quick">
    <button data-act="add-g"><span class="ic blue">🩸</span>Glucose</button>
    <button data-act="add-expense"><span class="ic red">➖</span>Expense</button>
    <button data-act="add-income"><span class="ic green">➕</span>Income</button>
  </div>

  <section class="card">
    <h2>Latest glucose<span class="spacer"></span><a href="#/glucose">See all</a></h2>
    ${last ? (() => {
      const st = status(last.v, last.type, D);
      return `<div class="hero">
        <div class="big-reading">${fmtG(last.v, u)}<small>${u}</small></div>
        <div class="grow"><span class="pill st-${st}">${STATUS_LABEL[st]}</span>
          <div class="small muted" style="margin-top:6px">${rType(last.type).icon} ${esc(rType(last.type).name)} · ${dayLabel(dayKey(last.t))} ${timeStr(last.t)}</div></div>
      </div>
      <div class="grid3" style="margin-top:14px">
        <div class="stat"><div class="k">Today</div><div class="v">${todayR.length}<small> readings</small></div></div>
        <div class="stat"><div class="k">7-day avg</div><div class="v">${ws ? fmtG(ws.avg, u) : '–'}</div></div>
        <div class="stat"><div class="k">In range</div><div class="v">${ws ? Math.round(ws.inRange * 100) + '%' : '–'}</div></div>
      </div>
      ${week.length > 1 ? '<div class="chart-box sm" style="margin-top:12px"><canvas id="c-home"></canvas></div>' : ''}`;
    })() : `<div class="empty"><span class="e">🩸</span>No readings yet.<br><button class="btn primary" style="margin-top:12px" data-act="add-g">Add your first reading</button></div>`}
  </section>

  <section class="card">
    <h2>Today's money<span class="spacer"></span><a href="#/reports">Daily report</a></h2>
    <div class="grid3">
      <div class="stat"><div class="k">Income</div><div class="v income">${fmtMoney(cur.income, mainCur, { compact: true })}</div></div>
      <div class="stat"><div class="k">Spent</div><div class="v expense">${fmtMoney(cur.expense, mainCur, { compact: true })}</div></div>
      <div class="stat"><div class="k">Net</div><div class="v">${fmtMoney(cur.income - cur.expense, mainCur, { compact: true })}</div></div>
    </div>
    ${otherCurs.map((c) => `<div class="small muted" style="margin-top:8px">${c}: +${fmtMoney(tot[c].income, c)} / −${fmtMoney(tot[c].expense, c)}</div>`).join('')}
    ${todayT.length ? `<ul class="list" style="margin-top:8px">${[...todayT].sort(sortDesc).slice(0, 4).map(txnItem).join('')}</ul>` : '<p class="small muted" style="margin:12px 0 0">Nothing recorded today.</p>'}
  </section>`;
  bindLockBtn();
  bindCommon();
  if (week.length > 1) glucoseLine('c-home', week, true);
}

// ================= GLUCOSE =================
function viewGlucose() {
  const u = unit();
  const since = ui.gPeriod ? Date.now() - ui.gPeriod * 864e5 : 0;
  let rs = D.readings.filter((r) => new Date(r.t) >= since);
  if (ui.gType !== 'all') rs = rs.filter((r) => (ui.gType.startsWith('grp:') ? rType(r.type).group === ui.gType.slice(4) : r.type === ui.gType));
  rs.sort(sortDesc);
  const s = glucoseStats(rs, D);
  const usedTypes = [...new Set(D.readings.map((r) => r.type))];

  appEl.innerHTML = `
  ${header('Glucose', `${D.readings.length} readings recorded`, `<button class="icon-btn" data-act="add-g" aria-label="Add reading">＋</button>`)}
  <div class="chips">${[[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days'], [0, 'All']].map(([v, l]) => `<button class="chip ${ui.gPeriod === v ? 'on' : ''}" data-period="${v}">${l}</button>`).join('')}</div>
  <label class="f" style="margin-bottom:12px"><select class="input" id="g-type">
    <option value="all">All reading types</option>
    <optgroup label="Groups">${Object.entries(TARGET_GROUPS).map(([k, g]) => `<option value="grp:${k}" ${ui.gType === 'grp:' + k ? 'selected' : ''}>${g.label}</option>`).join('')}</optgroup>
    <optgroup label="Types">${D.readingTypes.filter((t) => usedTypes.includes(t.id)).map((t) => `<option value="${t.id}" ${ui.gType === t.id ? 'selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</optgroup>
  </select></label>

  ${s ? `
  <section class="card">
    <div class="grid3">
      <div class="stat"><div class="k">Average</div><div class="v">${fmtG(s.avg, u)}</div></div>
      <div class="stat"><div class="k">In range</div><div class="v" style="color:var(--ok)">${Math.round(s.inRange * 100)}%</div></div>
      <div class="stat"><div class="k">Est. A1c</div><div class="v">${s.n >= 10 ? s.eA1c.toFixed(1) + '%' : '–'}</div></div>
      <div class="stat"><div class="k">Lowest</div><div class="v">${fmtG(s.min, u)}</div></div>
      <div class="stat"><div class="k">Highest</div><div class="v">${fmtG(s.max, u)}</div></div>
      <div class="stat"><div class="k">Readings</div><div class="v">${s.n}</div></div>
    </div>
    <div class="row small muted" style="margin-top:10px;gap:14px;flex-wrap:wrap">
      <span class="row" style="gap:5px"><i class="dot low"></i>${s.low} low</span>
      <span class="row" style="gap:5px"><i class="dot ok"></i>${s.n - s.low - s.high} in range</span>
      <span class="row" style="gap:5px"><i class="dot high"></i>${s.high} high</span>
      ${s.n < 10 ? '<span>· A1c estimate needs 10+ readings</span>' : ''}
    </div>
  </section>
  <section class="card"><h2>Trend</h2><div class="chart-box"><canvas id="c-trend"></canvas></div>
    <p class="small muted" style="margin:8px 0 0">Shaded band = your target range. Tap a point for details.</p></section>
  ${ui.gType === 'all' ? `<section class="card"><h2>Average by reading type</h2><div class="chart-box" id="bytype-box"><canvas id="c-bytype"></canvas></div></section>` : ''}
  ` : ''}

  <section class="card"><h2>History</h2>
    ${rs.length ? [...groupBy(rs.slice(0, ui.gLimit), (r) => dayKey(r.t))].map(([k, list]) => `<div class="day-h"><span>${dayLabel(k)}</span><span>${list.length} reading${list.length > 1 ? 's' : ''}</span></div>
      <ul class="list">${list.map(readingItem).join('')}</ul>`).join('') : `<div class="empty"><span class="e">📈</span>No readings in this period.</div>`}
    ${rs.length > ui.gLimit ? `<button class="btn block" id="g-more" style="margin-top:10px">Show more (${rs.length - ui.gLimit} older)</button>` : ''}
  </section>`;

  $$('[data-period]').forEach((b) => b.onclick = () => { ui.gPeriod = +b.dataset.period; ui.gLimit = 40; render(); });
  $('#g-type').onchange = (e) => { ui.gType = e.target.value; ui.gLimit = 40; render(); };
  $('#g-more')?.addEventListener('click', () => { const y = scrollY; ui.gLimit += 60; render(); scrollTo(0, y); });
  bindCommon();
  if (s) {
    glucoseLine('c-trend', rs);
    if (ui.gType === 'all') byTypeChart(rs);
  }
}

function readingItem(r) {
  const t = rType(r.type), st = status(r.v, r.type, D);
  const extra = [r.insulin ? `💉 ${r.insulin}u${r.insulinType ? ' ' + esc(r.insulinType) : ''}` : '', r.carbs ? `🍞 ${r.carbs}g` : '', r.meds ? `💊 ${esc(r.meds)}` : '', r.note ? esc(r.note) : ''].filter(Boolean).join(' · ');
  return `<li class="item" data-edit-r="${r.id}"><div class="emo">${t.icon}</div>
    <div class="grow"><div class="t1">${esc(t.name)}</div><div class="t2">${timeStr(r.t)}${extra ? ' · ' + extra : ''}</div></div>
    <div class="amt"><span class="pill st-${st}">${fmtG(r.v, unit())}</span></div></li>`;
}

function glucoseLine(id, readings, mini = false) {
  const u = unit();
  const pts = [...readings].sort((a, b) => new Date(a.t) - new Date(b.t));
  const [lo, hi] = D.settings.targets.other;
  const conv = (v) => toDisplay(v, u);
  const colorFor = (r) => ({ ok: cssVar('--ok'), low: cssVar('--low'), below: cssVar('--warn'), high: cssVar('--warn'), veryhigh: cssVar('--bad') }[status(r.v, r.type, D)]);
  const tMin = new Date(pts[0].t).getTime(), tMax = new Date(pts[pts.length - 1].t).getTime();
  const span = Math.max(tMax - tMin, 864e5);
  const fmtTick = (v) => span > 2 * 864e5 ? new Date(v).toLocaleDateString([], { day: 'numeric', month: 'short' }) : timeStr(v);
  const band = (val) => ({ data: [{ x: tMin, y: conv(val) }, { x: tMax, y: conv(val) }], pointRadius: 0, borderWidth: 0 });
  const ctx = document.getElementById(id);
  const grid = cssVar('--line'), muted = cssVar('--muted');
  charts.push(new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { ...band(hi), fill: '+1', backgroundColor: cssVar('--ok') + '22' },
        { ...band(lo), fill: false },
        {
          data: pts.map((r) => ({ x: new Date(r.t).getTime(), y: conv(r.v), r })),
          borderColor: cssVar('--primary'), borderWidth: 2, tension: .3,
          pointBackgroundColor: pts.map(colorFor), pointBorderColor: pts.map(colorFor),
          pointRadius: mini ? 2.5 : 4, pointHoverRadius: 7,
        },
      ],
    },
    options: {
      maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { type: 'linear', min: tMin, max: tMax, ticks: { callback: fmtTick, maxTicksLimit: mini ? 4 : 6, color: muted, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: muted, font: { size: 11 } }, grid: { color: grid }, suggestedMin: conv(60), suggestedMax: conv(220) },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (i) => i.datasetIndex === 2,
          callbacks: {
            title: (i) => { const r = i[0].raw.r; return `${new Date(r.t).toLocaleDateString([], { day: 'numeric', month: 'short' })} ${timeStr(r.t)}`; },
            label: (i) => { const r = i.raw.r; return `${fmtG(r.v, u)} ${u} · ${rType(r.type).name}`; },
          },
        },
      },
    },
  }));
}

function byTypeChart(rs) {
  const u = unit();
  const g = groupBy(rs, (r) => r.type);
  const rows = [...g].map(([k, list]) => ({ t: rType(k), avg: list.reduce((a, r) => a + r.v, 0) / list.length, n: list.length, type: k }))
    .sort((a, b) => D.readingTypes.indexOf(a.t) - D.readingTypes.indexOf(b.t));
  $('#bytype-box').style.height = Math.max(120, rows.length * 34 + 30) + 'px';
  charts.push(new Chart(document.getElementById('c-bytype'), {
    type: 'bar',
    data: {
      labels: rows.map((r) => `${r.t.icon} ${r.t.name}`),
      datasets: [{
        data: rows.map((r) => toDisplay(r.avg, u)), borderRadius: 6, barThickness: 18,
        backgroundColor: rows.map((r) => ({ ok: cssVar('--ok'), low: cssVar('--low'), below: cssVar('--warn'), high: cssVar('--warn'), veryhigh: cssVar('--bad') }[status(r.avg, r.type, D)])),
      }],
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false, animation: false,
      scales: { x: { grid: { color: cssVar('--line') }, ticks: { color: cssVar('--muted') } }, y: { grid: { display: false }, ticks: { color: cssVar('--text'), font: { size: 12 } } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => `avg ${i.raw} ${u} (${rows[i.dataIndex].n} readings)` } } },
    },
  }));
}

function glucoseForm(r) {
  const u = unit();
  const isEdit = !!r;
  const now = new Date();
  r = r || { t: now.toISOString(), type: suggestReadingType(now) };
  let sel = r.type;
  openSheet(`<h3><span class="grow">${isEdit ? 'Edit reading' : 'New glucose reading'}</span>${isEdit ? '<button class="link" style="color:var(--bad)" data-x="del">Delete</button>' : ''}</h3>
    <form id="gf">
      <input class="big-input" id="g-v" type="number" inputmode="decimal" step="${u === 'mmol/L' ? '0.1' : '1'}" min="0" placeholder="${u === 'mmol/L' ? '6.5' : '120'}" value="${r.v ? toDisplay(r.v, u) : ''}" required>
      <div class="unit-tag">${u} · <span id="g-st"></span></div>
      <label class="f"><span>When was it measured?</span></label>
      <div class="typegrid" id="g-types">${D.readingTypes.map((t) => `<button type="button" data-t="${t.id}" class="${t.id === sel ? 'on' : ''}"><span class="e">${t.icon}</span>${esc(t.name)}</button>`).join('')}
        <button type="button" data-x="newtype"><span class="e">➕</span>Custom type</button></div>
      <label class="f"><span>Date & time</span><input class="input" type="datetime-local" id="g-t" value="${localInputValue(r.t)}" required></label>
      <details class="more" ${r.insulin || r.carbs || r.meds || r.note ? 'open' : ''}><summary>＋ Insulin, carbs, medicine & notes</summary>
        <div class="grid2">
          <label class="f"><span>Insulin (units)</span><input class="input" id="g-ins" type="number" inputmode="decimal" step="0.5" min="0" value="${r.insulin ?? ''}"></label>
          <label class="f"><span>Insulin type</span><select class="input" id="g-inst">${['', 'Rapid / meal', 'Long-acting / basal', 'Mixed', 'Correction'].map((o) => `<option ${o === (r.insulinType || '') ? 'selected' : ''} value="${o}">${o || '—'}</option>`).join('')}</select></label>
        </div>
        <label class="f"><span>Carbs (grams)</span><input class="input" id="g-carbs" type="number" inputmode="numeric" min="0" value="${r.carbs ?? ''}"></label>
        <label class="f"><span>Medicine taken</span><input class="input" id="g-meds" placeholder="e.g. Metformin 500mg" value="${esc(r.meds || '')}"></label>
        <label class="f"><span>Notes</span><textarea class="input" id="g-note" placeholder="How you felt, what you ate, exercise…">${esc(r.note || '')}</textarea></label>
      </details>
      <div class="err" id="g-err"></div>
      <button class="btn primary block">${isEdit ? 'Save changes' : 'Save reading'}</button>
    </form>`, (s) => {
    const vEl = $('#g-v', s);
    const upd = () => {
      const v = parseFloat(vEl.value);
      const st = v > 0 ? status(fromInput(v, u), sel, D) : null;
      $('#g-st', s).innerHTML = st ? `<span class="pill st-${st}">${STATUS_LABEL[st]}</span>` : 'enter your reading';
    };
    vEl.oninput = upd; upd();
    if (!isEdit) setTimeout(() => vEl.focus(), 250);
    $('#g-types', s).onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x === 'newtype') return typeForm(null, () => glucoseForm({ ...r, v: fromInput(parseFloat(vEl.value) || 0, u) || undefined }));
      sel = b.dataset.t; $$('#g-types button', s).forEach((x) => x.classList.toggle('on', x === b)); upd();
    };
    $('[data-x=del]', s)?.addEventListener('click', () => confirmSheet('Delete reading?', 'This can\'t be undone.', 'Delete', () => { D.readings = D.readings.filter((x) => x.id !== r.id); commit(); toast('Reading deleted'); }));
    $('#gf', s).onsubmit = (e) => {
      e.preventDefault();
      const v = parseFloat(vEl.value);
      const mg = fromInput(v, u);
      if (!(mg >= 10 && mg <= 700)) return ($('#g-err', s).textContent = `Please enter a value between ${fmtG(10, u)} and ${fmtG(700, u)} ${u}.`);
      const num = (id) => { const x = parseFloat($(id, s).value); return Number.isFinite(x) ? x : undefined; };
      const rec = {
        id: r.id || uid(), v: Math.round(mg * 10) / 10, type: sel, t: new Date($('#g-t', s).value).toISOString(),
        insulin: num('#g-ins'), insulinType: $('#g-inst', s).value || undefined, carbs: num('#g-carbs'),
        meds: $('#g-meds', s).value.trim() || undefined, note: $('#g-note', s).value.trim() || undefined,
      };
      D.readings = D.readings.filter((x) => x.id !== rec.id).concat(rec);
      closeSheet(); commit();
      const st = status(rec.v, rec.type, D);
      toast(st === 'low' ? '⚠️ Low reading. Follow your hypo plan (e.g. 15g fast sugar) and recheck in 15 min.' : st === 'veryhigh' ? '⚠️ Very high reading. Follow your doctor\'s plan.' : 'Reading saved');
    };
  });
}

function typeForm(t, back) {
  const isEdit = !!t;
  t = t || { name: '', icon: '🩸', group: 'other' };
  openSheet(`<h3><span class="grow">${isEdit ? 'Edit reading type' : 'New reading type'}</span>${isEdit ? '<button class="link" style="color:var(--bad)" data-x="del">Delete</button>' : ''}</h3>
    <form id="tf">
      <div class="grid2" style="grid-template-columns:90px 1fr">
        <label class="f"><span>Icon</span><input class="input center" id="t-icon" value="${esc(t.icon)}" maxlength="4"></label>
        <label class="f"><span>Name</span><input class="input" id="t-name" value="${esc(t.name)}" placeholder="e.g. 1h after lunch" required></label>
      </div>
      <label class="f"><span>Which target range applies?</span><select class="input" id="t-group">${Object.entries(TARGET_GROUPS).map(([k, g]) => `<option value="${k}" ${k === t.group ? 'selected' : ''}>${g.label}</option>`).join('')}</select></label>
      <button class="btn primary block">Save</button>
    </form>`, (s) => {
    $('[data-x=del]', s)?.addEventListener('click', () => {
      if (D.readings.some((r) => r.type === t.id)) return toast('This type has readings, so it can\'t be deleted');
      D.readingTypes = D.readingTypes.filter((x) => x.id !== t.id); commit(); closeSheet(); back?.();
    });
    $('#tf', s).onsubmit = (e) => {
      e.preventDefault();
      const rec = { id: t.id || uid(), name: $('#t-name', s).value.trim(), icon: $('#t-icon', s).value.trim() || '🩸', group: $('#t-group', s).value };
      const i = D.readingTypes.findIndex((x) => x.id === rec.id);
      if (i >= 0) D.readingTypes[i] = rec; else D.readingTypes.push(rec);
      persist(); closeSheet(); back ? back() : render();
    };
  });
}

// ================= MONEY =================
function viewMoney() {
  const mk = ui.mMonth;
  let tx = D.txns.filter((t) => monthKey(t.t) === mk);
  const monthTot = totalsByCurrency(tx, D.accounts);
  if (ui.mKind !== 'all') tx = tx.filter((t) => t.kind === ui.mKind);
  if (ui.mQuery) {
    const q = ui.mQuery.toLowerCase();
    tx = tx.filter((t) => [t.note, t.payee, cat(t.categoryId).name, acct(t.accountId)?.name].some((x) => (x || '').toLowerCase().includes(q)));
  }
  tx.sort(sortDesc);
  const balByCur = {};
  for (const a of D.accounts.filter((a) => !a.archived)) { balByCur[a.currency] = (balByCur[a.currency] || 0) + accountBalance(a, D.txns); }

  appEl.innerHTML = `
  ${header('Money', Object.entries(balByCur).map(([c, v]) => `Total ${fmtMoney(v, c)}`).join(' · '), `<button class="icon-btn" data-act="add-expense" aria-label="Add transaction">＋</button>`)}
  <div class="acc-scroll">
    ${D.accounts.filter((a) => !a.archived).map((a) => { const b = accountBalance(a, D.txns); return `<div class="acc" data-edit-a="${a.id}"><div class="n">${DEFAULT_ACCOUNT_TYPES[a.type]?.icon || '👛'} ${esc(a.name)}</div><div class="b ${b < 0 ? 'expense' : ''}">${fmtMoney(b, a.currency)}</div></div>`; }).join('')}
    <div class="acc center" data-act="add-account" style="display:grid;place-items:center;min-width:110px;cursor:pointer"><div class="n">＋ Account</div></div>
  </div>
  <div class="datenav">
    <button class="icon-btn" data-m="-1" aria-label="Previous month">‹</button>
    <div class="lbl">${monthLabel(mk)}</div>
    <button class="icon-btn" data-m="1" aria-label="Next month">›</button>
  </div>
  <section class="card">
    ${Object.keys(monthTot).length ? Object.entries(monthTot).map(([c, v]) => `
      <div class="grid3" style="margin-bottom:6px">
        <div class="stat"><div class="k">Income ${Object.keys(monthTot).length > 1 ? c : ''}</div><div class="v income">${fmtMoney(v.income, c, { compact: true })}</div></div>
        <div class="stat"><div class="k">Expenses</div><div class="v expense">${fmtMoney(v.expense, c, { compact: true })}</div></div>
        <div class="stat"><div class="k">Net</div><div class="v">${fmtMoney(v.income - v.expense, c, { compact: true })}</div></div>
      </div>`).join('') : '<p class="muted small" style="margin:0">No transactions this month.</p>'}
  </section>
  <div class="chips">${[['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers']].map(([v, l]) => `<button class="chip ${ui.mKind === v ? 'on' : ''}" data-kind="${v}">${l}</button>`).join('')}</div>
  <input class="input" id="m-q" type="search" placeholder="🔍 Search notes, categories, accounts" value="${esc(ui.mQuery)}" style="margin-bottom:6px">
  <section>
    ${tx.length ? [...groupBy(tx, (t) => dayKey(t.t))].map(([k, list]) => {
      const tt = totalsByCurrency(list, D.accounts);
      const net = Object.entries(tt).map(([c, v]) => fmtMoney(v.income - v.expense, c)).join(' · ');
      return `<div class="day-h"><span>${dayLabel(k)}</span><span>${net}</span></div><div class="card" style="padding:4px 16px;margin-bottom:8px"><ul class="list">${list.map(txnItem).join('')}</ul></div>`;
    }).join('') : `<div class="card empty"><span class="e">🧾</span>No transactions found.<br><button class="btn primary" style="margin-top:12px" data-act="add-expense">Add a transaction</button></div>`}
  </section>`;
  $$('[data-m]').forEach((b) => b.onclick = () => { ui.mMonth = shiftMonth(ui.mMonth, +b.dataset.m); render(); });
  $$('[data-kind]').forEach((b) => b.onclick = () => { ui.mKind = b.dataset.kind; render(); });
  $('#m-q').oninput = (e) => {
    ui.mQuery = e.target.value; const pos = e.target.selectionStart; render();
    const q = $('#m-q'); q.focus(); q.setSelectionRange(pos, pos);
  };
  bindCommon();
}

function txnItem(t) {
  const a = acct(t.accountId);
  if (t.kind === 'transfer') {
    const b = acct(t.toAccountId);
    return `<li class="item" data-edit-t="${t.id}"><div class="emo">🔁</div><div class="grow"><div class="t1">Transfer</div>
      <div class="t2">${esc(a?.name)} → ${esc(b?.name)}${t.note ? ' · ' + esc(t.note) : ''}</div></div>
      <div class="amt">${fmtMoney(t.amount, a?.currency || D.settings.currency)}</div></li>`;
  }
  const c = cat(t.categoryId);
  return `<li class="item" data-edit-t="${t.id}"><div class="emo" style="background:${c.color}22">${c.icon}</div>
    <div class="grow"><div class="t1">${esc(t.payee || c.name)}</div><div class="t2">${t.payee ? esc(c.name) + ' · ' : ''}${esc(a?.name || '')} · ${timeStr(t.t)}${t.note ? ' · ' + esc(t.note) : ''}</div></div>
    <div class="amt ${t.kind}">${t.kind === 'income' ? '+' : '−'}${fmtMoney(t.amount, curOf(t))}</div></li>`;
}

function txnForm(kind, t) {
  const isEdit = !!t;
  const accs = D.accounts.filter((a) => !a.archived || a.id === t?.accountId || a.id === t?.toAccountId);
  t = t || { kind, t: new Date().toISOString(), accountId: D.settings.lastAccount && acct(D.settings.lastAccount) ? D.settings.lastAccount : accs[0]?.id };
  let k = t.kind;
  let selCat = t.categoryId;
  const draw = (s) => {
    const cats = D.categories.filter((c) => c.kind === k);
    if (!cats.find((c) => c.id === selCat)) selCat = D.settings['lastCat_' + k] && cats.find((c) => c.id === D.settings['lastCat_' + k]) ? D.settings['lastCat_' + k] : undefined;
    const from = acct($('#t-acc', s)?.value || t.accountId);
    $('#t-dyn', s).innerHTML = k === 'transfer' ? `
      <label class="f"><span>To account</span><select class="input" id="t-to">${accs.filter((a) => a.id !== from?.id).map((a) => `<option value="${a.id}" ${a.id === t.toAccountId ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('')}</select></label>
      <label class="f" id="t-toamt-wrap"><span>Amount received (other currency)</span><input class="input" id="t-toamt" type="number" inputmode="decimal" step="0.01" min="0" value="${t.toAmount ?? ''}"></label>`
      : `<label class="f"><span>Category</span></label>
      <div class="typegrid" id="t-cats">${cats.map((c) => `<button type="button" data-c="${c.id}" class="${c.id === selCat ? 'on' : ''}"><span class="e">${c.icon}</span>${esc(c.name)}</button>`).join('')}
      <button type="button" data-x="newcat"><span class="e">➕</span>New category</button></div>
      <label class="f"><span>${k === 'income' ? 'From (payer)' : 'Paid to (shop / person)'} · optional</span><input class="input" id="t-payee" value="${esc(t.payee || '')}" list="payees"></label>
      <datalist id="payees">${[...new Set(D.txns.map((x) => x.payee).filter(Boolean))].slice(0, 50).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
    const toggleToAmt = () => {
      const w = $('#t-toamt-wrap', s); if (!w) return;
      const to = acct($('#t-to', s)?.value); const fr = acct($('#t-acc', s).value);
      w.classList.toggle('hidden', !to || to.currency === fr?.currency);
    };
    $('#t-to', s)?.addEventListener('change', toggleToAmt); toggleToAmt();
    $('#t-cats', s)?.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x === 'newcat') return categoryForm({ kind: k }, () => txnForm(k, null));
      selCat = b.dataset.c; $$('#t-cats button', s).forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#t-cur', s).textContent = from?.currency || '';
    $('#t-amt', s).style.color = k === 'income' ? 'var(--income)' : k === 'expense' ? 'var(--expense)' : '';
  };
  if (!accs.length) { toast('Add an account first'); return accountForm(); }
  openSheet(`<h3><span class="grow">${isEdit ? 'Edit transaction' : 'New transaction'}</span>${isEdit ? '<button class="link" style="color:var(--bad)" data-x="del">Delete</button>' : ''}</h3>
    <form id="tf">
      <div class="seg kind">${[['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']].map(([v, l]) => `<button type="button" data-v="${v}" class="${v === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="big-input" id="t-amt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${t.amount ?? ''}" required>
      <div class="unit-tag" id="t-cur"></div>
      <label class="f"><span id="t-acc-l">${k === 'transfer' ? 'From account' : 'Account / paid with'}</span><select class="input" id="t-acc">${accs.map((a) => `<option value="${a.id}" ${a.id === t.accountId ? 'selected' : ''}>${DEFAULT_ACCOUNT_TYPES[a.type]?.icon || ''} ${esc(a.name)} (${a.currency})</option>`).join('')}</select></label>
      <div id="t-dyn"></div>
      <label class="f"><span>Date & time</span><input class="input" type="datetime-local" id="t-t" value="${localInputValue(t.t)}" required></label>
      <label class="f"><span>Note · optional</span><input class="input" id="t-note" value="${esc(t.note || '')}"></label>
      <div class="err" id="t-err"></div>
      <button class="btn primary block">${isEdit ? 'Save changes' : 'Save'}</button>
    </form>`, (s) => {
    draw(s);
    if (!isEdit) setTimeout(() => $('#t-amt', s)?.focus(), 250);
    $('.seg', s).onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      k = b.dataset.v; $$('.seg button', s).forEach((x) => x.classList.toggle('on', x === b));
      $('#t-acc-l', s).textContent = k === 'transfer' ? 'From account' : 'Account / paid with';
      draw(s);
    };
    $('#t-acc', s).onchange = () => draw(s);
    $('[data-x=del]', s)?.addEventListener('click', () => confirmSheet('Delete transaction?', 'This can\'t be undone.', 'Delete', () => { D.txns = D.txns.filter((x) => x.id !== t.id); commit(); toast('Deleted'); }));
    $('#tf', s).onsubmit = (e) => {
      e.preventDefault();
      const err = $('#t-err', s);
      const amount = Math.round(parseFloat($('#t-amt', s).value) * 100) / 100;
      if (!(amount > 0)) return (err.textContent = 'Enter an amount greater than 0.');
      const rec = { id: t.id || uid(), kind: k, amount, accountId: $('#t-acc', s).value, t: new Date($('#t-t', s).value).toISOString(), note: $('#t-note', s).value.trim() || undefined };
      if (k === 'transfer') {
        rec.toAccountId = $('#t-to', s)?.value;
        if (!rec.toAccountId) return (err.textContent = 'You need a second account to transfer to.');
        if (acct(rec.toAccountId).currency !== acct(rec.accountId).currency) {
          const ta = parseFloat($('#t-toamt', s).value);
          if (!(ta > 0)) return (err.textContent = 'Enter the amount received in the other currency.');
          rec.toAmount = ta;
        }
      } else {
        if (!selCat) return (err.textContent = 'Choose a category.');
        rec.categoryId = selCat;
        rec.payee = $('#t-payee', s).value.trim() || undefined;
        D.settings['lastCat_' + k] = selCat;
      }
      D.settings.lastAccount = rec.accountId;
      D.txns = D.txns.filter((x) => x.id !== rec.id).concat(rec);
      closeSheet(); commit(); toast('Saved');
    };
  });
}

function accountForm(a, back) {
  const isEdit = !!a;
  a = a || { name: '', type: 'bank', currency: D.settings.currency, opening: 0 };
  openSheet(`<h3><span class="grow">${isEdit ? 'Edit account' : 'New account'}</span>${isEdit ? '<button class="link" style="color:var(--bad)" data-x="del">Delete</button>' : ''}</h3>
    <form id="af">
      <label class="f"><span>Name</span><input class="input" id="a-name" value="${esc(a.name)}" placeholder="e.g. CIB bank, Vodafone Cash" required></label>
      <label class="f"><span>Type</span><select class="input" id="a-type">${Object.entries(DEFAULT_ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
      <label class="f"><span>Currency</span><select class="input" id="a-cur" ${isEdit && D.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id) ? 'disabled' : ''}>${currencyOptions(a.currency)}</select></label>
      <label class="f"><span>Starting balance</span><input class="input" id="a-open" type="number" inputmode="decimal" step="0.01" value="${a.opening ?? 0}"></label>
      ${isEdit ? `<label class="row f" style="justify-content:space-between"><span style="margin:0">Hide (archive) this account</span><span class="switch"><input type="checkbox" id="a-arch" ${a.archived ? 'checked' : ''}><i></i></span></label>` : ''}
      <button class="btn primary block">Save</button>
    </form>`, (s) => {
    $('[data-x=del]', s)?.addEventListener('click', () => {
      if (D.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id)) return toast('This account has transactions. Archive it instead.');
      D.accounts = D.accounts.filter((x) => x.id !== a.id); commit(); closeSheet(); back?.();
    });
    $('#af', s).onsubmit = (e) => {
      e.preventDefault();
      const rec = { ...a, id: a.id || uid(), name: $('#a-name', s).value.trim(), type: $('#a-type', s).value, currency: $('#a-cur', s).value, opening: parseFloat($('#a-open', s).value) || 0, archived: $('#a-arch', s)?.checked || undefined };
      const i = D.accounts.findIndex((x) => x.id === rec.id);
      if (i >= 0) D.accounts[i] = rec; else D.accounts.push(rec);
      closeSheet(); commit(); back?.(); toast('Account saved');
    };
  });
}

function categoryForm(c, back) {
  const isEdit = !!c?.id;
  c = { name: '', icon: '🏷️', kind: 'expense', color: '#4a90d9', budget: 0, ...c };
  openSheet(`<h3><span class="grow">${isEdit ? 'Edit category' : 'New category'}</span>${isEdit ? '<button class="link" style="color:var(--bad)" data-x="del">Delete</button>' : ''}</h3>
    <form id="cf">
      <div class="seg kind">${[['expense', 'Expense'], ['income', 'Income']].map(([v, l]) => `<button type="button" data-v="${v}" class="${v === c.kind ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grid2" style="grid-template-columns:80px 1fr 64px">
        <label class="f"><span>Icon</span><input class="input center" id="c-icon" value="${esc(c.icon)}" maxlength="4"></label>
        <label class="f"><span>Name</span><input class="input" id="c-name" value="${esc(c.name)}" required></label>
        <label class="f"><span>Color</span><input class="input" type="color" id="c-color" value="${c.color}" style="padding:4px"></label>
      </div>
      <label class="f" id="c-bud-w"><span>Monthly budget in ${D.settings.currency} (0 = none)</span><input class="input" id="c-bud" type="number" inputmode="decimal" min="0" step="1" value="${c.budget || 0}"></label>
      <button class="btn primary block">Save</button>
    </form>`, (s) => {
    let kind = c.kind;
    const sync = () => $('#c-bud-w', s).classList.toggle('hidden', kind !== 'expense');
    sync();
    $('.seg', s).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; kind = b.dataset.v; $$('.seg button', s).forEach((x) => x.classList.toggle('on', x === b)); sync(); };
    $('[data-x=del]', s)?.addEventListener('click', () => {
      if (D.txns.some((t) => t.categoryId === c.id)) return toast('This category is in use and can\'t be deleted');
      D.categories = D.categories.filter((x) => x.id !== c.id); commit(); closeSheet(); back?.();
    });
    $('#cf', s).onsubmit = (e) => {
      e.preventDefault();
      const rec = { ...c, id: c.id || uid(), kind, name: $('#c-name', s).value.trim(), icon: $('#c-icon', s).value.trim() || '🏷️', color: $('#c-color', s).value, budget: parseFloat($('#c-bud', s).value) || 0 };
      const i = D.categories.findIndex((x) => x.id === rec.id);
      if (i >= 0) D.categories[i] = rec; else D.categories.push(rec);
      persist(); closeSheet(); back ? back() : render();
    };
  });
}

// ================= REPORTS =================
function viewReports() {
  appEl.innerHTML = `${header('Reports', '', `<button class="icon-btn" id="r-share" aria-label="Share report">↗︎</button>`)}
    <div class="seg"><button data-r="day" class="${ui.rMode === 'day' ? 'on' : ''}">Daily</button><button data-r="month" class="${ui.rMode === 'month' ? 'on' : ''}">Monthly</button></div>
    <div id="r-body"></div>`;
  $$('[data-r]').forEach((b) => b.onclick = () => { ui.rMode = b.dataset.r; render(); });
  const text = ui.rMode === 'day' ? reportDay() : reportMonth();
  $('#r-share').onclick = async () => {
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Report copied'); } } catch { /* cancelled */ }
  };
  bindCommon();
}

function categoryBreakdown(txns, kind) {
  const by = {};
  for (const t of txns.filter((x) => x.kind === kind)) {
    const c = curOf(t);
    by[c] ??= {};
    by[c][t.categoryId] = (by[c][t.categoryId] || 0) + t.amount;
  }
  return by;
}
function breakdownHTML(by, kind) {
  return Object.entries(by).map(([cur, m]) => {
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([cid, v]) => {
      const c = cat(cid);
      return `<div class="catrow"><div class="row"><span>${c.icon}</span><span class="grow">${esc(c.name)}</span><b class="${kind}">${fmtMoney(v, cur)}</b><span class="muted small" style="width:40px;text-align:right">${Math.round((v / total) * 100)}%</span></div>
        <div class="bar"><i style="width:${(v / total) * 100}%;background:${c.color}"></i></div></div>`;
    }).join('');
  }).join('');
}

function reportDay() {
  const k = ui.rDay;
  const u = unit();
  const rs = D.readings.filter((r) => dayKey(r.t) === k).sort((a, b) => new Date(a.t) - new Date(b.t));
  const tx = D.txns.filter((t) => dayKey(t.t) === k).sort(sortDesc);
  const s = glucoseStats(rs, D);
  const tot = totalsByCurrency(tx, D.accounts);
  const exp = categoryBreakdown(tx, 'expense');
  const inc = categoryBreakdown(tx, 'income');
  const nice = new Date(k + 'T12:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#r-body').innerHTML = `
    <div class="datenav">
      <button class="icon-btn" data-d="-1" aria-label="Previous day">‹</button>
      <label class="lbl" style="cursor:pointer">${dayLabel(k)}<div class="small muted" style="font-weight:500">${nice}</div><input type="date" id="r-date" value="${k}"></label>
      <button class="icon-btn" data-d="1" aria-label="Next day" ${k >= dayKey(new Date()) ? 'disabled style="opacity:.4"' : ''}>›</button>
    </div>
    <section class="card"><h2>🩸 Glucose</h2>
      ${s ? `<div class="grid3">
        <div class="stat"><div class="k">Average</div><div class="v">${fmtG(s.avg, u)}</div></div>
        <div class="stat"><div class="k">Low / High</div><div class="v">${fmtG(s.min, u)}<small> – ${fmtG(s.max, u)}</small></div></div>
        <div class="stat"><div class="k">In range</div><div class="v">${Math.round(s.inRange * 100)}%</div></div></div>
        <ul class="list" style="margin-top:8px">${rs.map(readingItem).join('')}</ul>`
      : '<p class="muted small" style="margin:0">No glucose readings on this day.</p>'}
    </section>
    <section class="card"><h2>💰 Money</h2>
      ${Object.keys(tot).length ? Object.entries(tot).map(([c, v]) => `<div class="grid3" style="margin-bottom:6px">
        <div class="stat"><div class="k">Income</div><div class="v income">${fmtMoney(v.income, c, { compact: true })}</div></div>
        <div class="stat"><div class="k">Expenses</div><div class="v expense">${fmtMoney(v.expense, c, { compact: true })}</div></div>
        <div class="stat"><div class="k">Net</div><div class="v">${fmtMoney(v.income - v.expense, c, { compact: true })}</div></div></div>`).join('')
      : `<p class="muted small" style="margin:0">${tx.length ? 'Only transfers on this day.' : 'No income or expenses on this day.'}</p>`}
      ${Object.keys(exp).length ? `<h2 style="margin-top:14px">Spending by category</h2>${breakdownHTML(exp, 'expense')}` : ''}
      ${Object.keys(inc).length ? `<h2 style="margin-top:14px">Income by category</h2>${breakdownHTML(inc, 'income')}` : ''}
      ${tx.length ? `<h2 style="margin-top:14px">Transactions</h2><ul class="list">${tx.map(txnItem).join('')}</ul>` : ''}
    </section>`;
  $$('[data-d]').forEach((b) => b.onclick = () => { ui.rDay = shiftDay(ui.rDay, +b.dataset.d); render(); });
  const di = $('#r-date');
  di.onchange = () => { if (di.value) { ui.rDay = di.value; render(); } };
  $('.datenav .lbl').onclick = (e) => { if (e.target !== di) { try { di.showPicker(); } catch { di.click(); } } };

  // Plain-text version for sharing
  const lines = [`Daily report – ${nice}`, ''];
  if (s) {
    lines.push(`Glucose: avg ${fmtG(s.avg, u)} ${u}, range ${fmtG(s.min, u)}–${fmtG(s.max, u)}, ${Math.round(s.inRange * 100)}% in range`);
    rs.forEach((r) => lines.push(`  ${timeStr(r.t)}  ${fmtG(r.v, u)}  ${rType(r.type).name}${r.insulin ? `  insulin ${r.insulin}u` : ''}${r.carbs ? `  carbs ${r.carbs}g` : ''}`));
  } else lines.push('Glucose: no readings');
  lines.push('');
  for (const [c, v] of Object.entries(tot)) lines.push(`Money (${c}): income ${fmtMoney(v.income, c)}, expenses ${fmtMoney(v.expense, c)}, net ${fmtMoney(v.income - v.expense, c)}`);
  tx.forEach((t) => lines.push(`  ${t.kind === 'income' ? '+' : t.kind === 'expense' ? '-' : '↔'} ${fmtMoney(t.amount, curOf(t))}  ${t.kind === 'transfer' ? 'Transfer' : cat(t.categoryId).name}${t.note ? ' – ' + t.note : ''}`));
  return lines.join('\n');
}

function reportMonth() {
  const mk = ui.rMonth;
  const u = unit();
  const rs = D.readings.filter((r) => monthKey(r.t) === mk);
  const tx = D.txns.filter((t) => monthKey(t.t) === mk);
  const s = glucoseStats(rs, D);
  const tot = totalsByCurrency(tx, D.accounts);
  const mainCur = D.settings.currency;
  const exp = categoryBreakdown(tx, 'expense');
  const budgets = D.categories.filter((c) => c.kind === 'expense' && c.budget > 0);
  const spentMain = exp[mainCur] || {};
  const daysIn = new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0).getDate();

  $('#r-body').innerHTML = `
    <div class="datenav">
      <button class="icon-btn" data-mm="-1" aria-label="Previous month">‹</button>
      <div class="lbl">${monthLabel(mk)}</div>
      <button class="icon-btn" data-mm="1" aria-label="Next month">›</button>
    </div>
    <section class="card"><h2>💰 Money</h2>
      ${Object.keys(tot).length ? Object.entries(tot).map(([c, v]) => `<div class="grid3" style="margin-bottom:6px">
        <div class="stat"><div class="k">Income</div><div class="v income">${fmtMoney(v.income, c, { compact: true })}</div></div>
        <div class="stat"><div class="k">Expenses</div><div class="v expense">${fmtMoney(v.expense, c, { compact: true })}</div></div>
        <div class="stat"><div class="k">Saved</div><div class="v">${v.income ? Math.round(((v.income - v.expense) / v.income) * 100) + '%' : '–'}</div></div></div>`).join('')
      : '<p class="muted small" style="margin:0">No transactions this month.</p>'}
      ${tot[mainCur] ? `<p class="small muted" style="margin:6px 0 0">Average spend per day: <b>${fmtMoney(tot[mainCur].expense / daysIn, mainCur)}</b></p>
        <h2 style="margin-top:14px">Daily income vs expenses (${mainCur})</h2><div class="chart-box sm"><canvas id="c-daily"></canvas></div>` : ''}
    </section>
    ${budgets.length ? `<section class="card"><h2>🎯 Budgets</h2>${budgets.map((c) => {
      const sp = spentMain[c.id] || 0; const pct = sp / c.budget;
      const col = pct > 1 ? 'var(--bad)' : pct > .8 ? 'var(--warn)' : 'var(--ok)';
      return `<div class="catrow"><div class="row"><span>${c.icon}</span><span class="grow">${esc(c.name)}</span><span class="small"><b>${fmtMoney(sp, mainCur, { compact: true })}</b> / ${fmtMoney(c.budget, mainCur, { compact: true })}</span></div>
        <div class="bar"><i style="width:${Math.min(pct, 1) * 100}%;background:${col}"></i></div></div>`;
    }).join('')}</section>` : ''}
    ${Object.keys(exp).length ? `<section class="card"><h2>Spending by category</h2>
      ${exp[mainCur] ? '<div class="chart-box sm"><canvas id="c-donut"></canvas></div>' : ''}${breakdownHTML(exp, 'expense')}</section>` : ''}
    <section class="card"><h2>🩸 Glucose</h2>
      ${s ? `<div class="grid3">
        <div class="stat"><div class="k">Average</div><div class="v">${fmtG(s.avg, u)}</div></div>
        <div class="stat"><div class="k">In range</div><div class="v">${Math.round(s.inRange * 100)}%</div></div>
        <div class="stat"><div class="k">Est. A1c</div><div class="v">${s.n >= 10 ? s.eA1c.toFixed(1) + '%' : '–'}</div></div>
        <div class="stat"><div class="k">Readings</div><div class="v">${s.n}</div></div>
        <div class="stat"><div class="k">Lows</div><div class="v" style="color:var(--low)">${s.low}</div></div>
        <div class="stat"><div class="k">Highs</div><div class="v" style="color:var(--warn)">${s.high}</div></div></div>
        ${rs.length > 1 ? '<div class="chart-box sm" style="margin-top:12px"><canvas id="c-mg"></canvas></div>' : ''}`
      : '<p class="muted small" style="margin:0">No glucose readings this month.</p>'}
    </section>`;
  $$('[data-mm]').forEach((b) => b.onclick = () => { ui.rMonth = shiftMonth(ui.rMonth, +b.dataset.mm); render(); });

  if (tot[mainCur]) {
    const days = Array.from({ length: daysIn }, (_, i) => i + 1);
    const sum = (kind, d) => tx.filter((t) => t.kind === kind && curOf(t) === mainCur && new Date(t.t).getDate() === d).reduce((a, t) => a + t.amount, 0);
    charts.push(new Chart($('#c-daily'), {
      type: 'bar',
      data: { labels: days, datasets: [
        { label: 'Income', data: days.map((d) => sum('income', d)), backgroundColor: cssVar('--income'), borderRadius: 3 },
        { label: 'Expenses', data: days.map((d) => sum('expense', d)), backgroundColor: cssVar('--expense'), borderRadius: 3 },
      ] },
      options: { maintainAspectRatio: false, animation: false, scales: { x: { grid: { display: false }, ticks: { color: cssVar('--muted'), maxTicksLimit: 10 } }, y: { grid: { color: cssVar('--line') }, ticks: { color: cssVar('--muted') } } },
        plugins: { legend: { labels: { color: cssVar('--text'), boxWidth: 12 } } } },
    }));
  }
  if (exp[mainCur]) {
    const ent = Object.entries(exp[mainCur]).sort((a, b) => b[1] - a[1]);
    charts.push(new Chart($('#c-donut'), {
      type: 'doughnut',
      data: { labels: ent.map(([c]) => cat(c).name), datasets: [{ data: ent.map((e) => e[1]), backgroundColor: ent.map(([c]) => cat(c).color), borderWidth: 0 }] },
      options: { maintainAspectRatio: false, animation: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { color: cssVar('--text'), boxWidth: 10, font: { size: 11 } } } } },
    }));
  }
  if (s && rs.length > 1) glucoseLine('c-mg', rs, true);

  const lines = [`Monthly report – ${monthLabel(mk)}`, ''];
  for (const [c, v] of Object.entries(tot)) lines.push(`Money (${c}): income ${fmtMoney(v.income, c)}, expenses ${fmtMoney(v.expense, c)}, net ${fmtMoney(v.income - v.expense, c)}`);
  for (const [cur, m] of Object.entries(exp)) Object.entries(m).sort((a, b) => b[1] - a[1]).forEach(([cid, v]) => lines.push(`  ${cat(cid).name}: ${fmtMoney(v, cur)}`));
  if (s) lines.push('', `Glucose: ${s.n} readings, avg ${fmtG(s.avg, u)} ${u}, ${Math.round(s.inRange * 100)}% in range, ${s.low} lows, ${s.high} highs${s.n >= 10 ? `, est. A1c ${s.eA1c.toFixed(1)}%` : ''}`);
  return lines.join('\n');
}

// ================= SETTINGS =================
function viewSettings(sub) {
  if (sub === 'types') return settingsTypes();
  if (sub === 'cats') return settingsCats();
  if (sub === 'accounts') return settingsAccounts();
  if (sub === 'targets') return settingsTargets();
  const S = D.settings;
  const item = (emo, label, right, attrs) => `<button class="set-item" ${attrs}><span class="emo">${emo}</span><span class="grow">${label}</span>${right ?? '<span class="chev">›</span>'}</button>`;
  appEl.innerHTML = `
  ${header('Settings', esc(vault.meta.username))}
  <section class="card"><h2>Glucose</h2>
    ${item('📏', 'Unit', `<select class="input" id="st-unit" style="width:auto;min-height:38px;padding:6px 34px 6px 10px"><option ${S.glucoseUnit === 'mg/dL' ? 'selected' : ''}>mg/dL</option><option ${S.glucoseUnit === 'mmol/L' ? 'selected' : ''}>mmol/L</option></select>`, '')}
    ${item('🎯', 'Target ranges & alerts', null, 'data-go="settings/targets"')}
    ${item('🏷️', 'Reading types', null, 'data-go="settings/types"')}
  </section>
  <section class="card"><h2>Money</h2>
    ${item('💱', 'Main currency', `<select class="input" id="st-cur" style="width:120px;min-height:38px;padding:6px 30px 6px 10px">${currencyOptions(S.currency)}</select>`, '')}
    ${item('🏦', 'Accounts', null, 'data-go="settings/accounts"')}
    ${item('🗂️', 'Categories & budgets', null, 'data-go="settings/cats"')}
  </section>
  <section class="card"><h2>Security</h2>
    ${item('👆', 'Fingerprint / Face ID unlock', `<label class="switch"><input type="checkbox" id="st-finger" ${vault.meta.passkey ? 'checked' : ''}><i></i></label>`, '')}
    ${item('⏱️', 'Auto-lock', `<select class="input" id="st-lock" style="width:auto;min-height:38px;padding:6px 34px 6px 10px">${[[0, 'Immediately'], [1, '1 min'], [3, '3 min'], [5, '5 min'], [15, '15 min']].map(([v, l]) => `<option value="${v}" ${S.autoLockMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`, '')}
    ${item('🔑', 'Change password', null, 'data-act="chpw"')}
    ${item('🔒', 'Lock now', null, 'data-act="lock"')}
  </section>
  <section class="card"><h2>Appearance</h2>
    ${item('🌓', 'Theme', `<select class="input" id="st-theme" style="width:auto;min-height:38px;padding:6px 34px 6px 10px">${[['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${S.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`, '')}
    ${item('🙂', 'Your name', `<span class="muted">${esc(D.profile.name)}</span>`, 'data-act="name"')}
  </section>
  <section class="card"><h2>Your data</h2>
    ${item('💾', 'Download encrypted backup', null, 'data-act="backup"')}
    ${item('📥', 'Restore from backup', null, 'data-act="restore"')}
    ${item('📄', 'Export glucose readings (CSV)', null, 'data-act="csv-g"')}
    ${item('📄', 'Export transactions (CSV)', null, 'data-act="csv-t"')}
    ${item('🗑️', '<span style="color:var(--bad)">Delete all data on this device</span>', '', 'data-act="wipe"')}
  </section>
  <p class="small muted center">Your data is encrypted with AES-256 and never leaves this device unless you export it.<br>This app is not a medical device; follow your doctor's advice.</p>`;

  $$('[data-go]').forEach((b) => b.onclick = () => { location.hash = '#/' + b.dataset.go; });
  $('#st-unit').onchange = (e) => { S.glucoseUnit = e.target.value; persist(); toast('Unit updated'); };
  $('#st-cur').onchange = (e) => { S.currency = e.target.value; persist(); toast('Main currency updated'); };
  $('#st-lock').onchange = (e) => { S.autoLockMin = +e.target.value; persist(); };
  $('#st-theme').onchange = (e) => { S.theme = e.target.value; persist(); applyTheme(); };
  $('#st-finger').onchange = async (e) => {
    if (e.target.checked) {
      if (!(await vault.passkeySupported())) { e.target.checked = false; return toast('Fingerprint/Face ID isn\'t available on this device or browser'); }
      try { await vault.enablePasskey(); toast('Fingerprint unlock is on'); } catch (ex) { e.target.checked = false; toast(ex.name === 'NotAllowedError' ? 'Cancelled' : ex.message); }
    } else { await vault.disablePasskey(); toast('Fingerprint unlock is off'); }
  };
  const acts = {
    lock: lockNow,
    chpw: changePwForm,
    name: () => openSheet(`<h3>Your name</h3><form id="nf"><label class="f"><input class="input" id="n-v" value="${esc(D.profile.name)}" required></label><button class="btn primary block">Save</button></form>`,
      (s) => { $('#nf', s).onsubmit = (e) => { e.preventDefault(); D.profile.name = $('#n-v', s).value.trim(); closeSheet(); commit(); }; }),
    backup: backupFlow,
    restore: () => restoreFlow(false),
    'csv-g': () => {
      const u = unit();
      const rows = [['date', 'time', `glucose_${u}`, 'glucose_mg_dl', 'type', 'status', 'insulin_units', 'insulin_type', 'carbs_g', 'medicine', 'note']];
      [...D.readings].sort((a, b) => new Date(a.t) - new Date(b.t)).forEach((r) => rows.push([dayKey(r.t), timeStr(r.t), fmtG(r.v, u), Math.round(r.v), rType(r.type).name, STATUS_LABEL[status(r.v, r.type, D)], r.insulin ?? '', r.insulinType ?? '', r.carbs ?? '', r.meds ?? '', r.note ?? '']));
      download(`glucose-${dayKey(new Date())}.csv`, '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
    },
    'csv-t': () => {
      const rows = [['date', 'time', 'type', 'amount', 'currency', 'account', 'to_account', 'to_amount', 'category', 'payee', 'note']];
      [...D.txns].sort((a, b) => new Date(a.t) - new Date(b.t)).forEach((t) => rows.push([dayKey(t.t), timeStr(t.t), t.kind, t.amount, curOf(t), acct(t.accountId)?.name, acct(t.toAccountId)?.name ?? '', t.toAmount ?? '', t.categoryId ? cat(t.categoryId).name : '', t.payee ?? '', t.note ?? '']));
      download(`transactions-${dayKey(new Date())}.csv`, '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
    },
    wipe: () => confirmSheet('Delete all data?', 'All readings, transactions and settings on this device will be permanently deleted. Download a backup first if you want to keep them.', 'Delete everything',
      async () => { await vault.wipe(); D = null; location.hash = ''; render(); }),
  };
  $$('[data-act]', appEl).forEach((b) => b.onclick = () => acts[b.dataset.act]?.());
}

function backLink(title) {
  return `<header class="top"><a class="icon-btn" href="#/settings" style="text-decoration:none" aria-label="Back">‹</a><div class="grow"><h1>${title}</h1></div></header>`;
}
function settingsTypes() {
  appEl.innerHTML = `${backLink('Reading types')}
    <p class="muted small">These are the choices you see when adding a reading. Tap to edit, or add your own.</p>
    <section class="card"><ul class="list">${D.readingTypes.map((t) => `<li class="item" data-ty="${t.id}"><div class="emo">${t.icon}</div><div class="grow"><div class="t1">${esc(t.name)}</div><div class="t2">${TARGET_GROUPS[t.group]?.label}</div></div><span class="muted">›</span></li>`).join('')}</ul></section>
    <button class="btn primary block" id="ty-add">＋ Add reading type</button>`;
  $$('[data-ty]').forEach((li) => li.onclick = () => typeForm(D.readingTypes.find((t) => t.id === li.dataset.ty), render));
  $('#ty-add').onclick = () => typeForm(null, render);
}
function settingsCats() {
  const list = (kind) => D.categories.filter((c) => c.kind === kind).map((c) => `<li class="item" data-cat="${c.id}"><div class="emo" style="background:${c.color}22">${c.icon}</div><div class="grow"><div class="t1">${esc(c.name)}</div>${c.budget ? `<div class="t2">Budget ${fmtMoney(c.budget, D.settings.currency, { compact: true })}/month</div>` : ''}</div><span class="muted">›</span></li>`).join('');
  appEl.innerHTML = `${backLink('Categories')}
    <section class="card"><h2>Expense categories</h2><ul class="list">${list('expense')}</ul></section>
    <section class="card"><h2>Income categories</h2><ul class="list">${list('income')}</ul></section>
    <button class="btn primary block" id="c-add">＋ Add category</button>`;
  $$('[data-cat]').forEach((li) => li.onclick = () => categoryForm(D.categories.find((c) => c.id === li.dataset.cat), render));
  $('#c-add').onclick = () => categoryForm({}, render);
}
function settingsAccounts() {
  appEl.innerHTML = `${backLink('Accounts')}
    <p class="muted small">Cash, bank accounts, cards and wallets. Each account has its own currency.</p>
    <section class="card"><ul class="list">${D.accounts.map((a) => `<li class="item" data-edit-a="${a.id}"><div class="emo">${DEFAULT_ACCOUNT_TYPES[a.type]?.icon || '👛'}</div><div class="grow"><div class="t1">${esc(a.name)}${a.archived ? ' <span class="muted small">(archived)</span>' : ''}</div><div class="t2">${DEFAULT_ACCOUNT_TYPES[a.type]?.label} · ${a.currency}</div></div><div class="amt">${fmtMoney(accountBalance(a, D.txns), a.currency)}</div></li>`).join('')}</ul></section>
    <button class="btn primary block" data-act="add-account">＋ Add account</button>`;
  bindCommon();
}
function settingsTargets() {
  const u = unit(), S = D.settings;
  const inp = (id, v) => `<input class="input" id="${id}" type="number" inputmode="decimal" step="${u === 'mmol/L' ? '0.1' : '1'}" value="${toDisplay(v, u)}" required>`;
  appEl.innerHTML = `${backLink('Targets')}
    <div class="notice small">Default ranges follow common guidance. Ask your doctor for your personal targets and set them here.</div>
    <form id="tg">
    ${Object.entries(TARGET_GROUPS).map(([k, g]) => `<section class="card"><h2>${g.label}</h2><div class="grid2">
      <label class="f" style="margin:0"><span>From (${u})</span>${inp('lo-' + k, S.targets[k][0])}</label>
      <label class="f" style="margin:0"><span>To (${u})</span>${inp('hi-' + k, S.targets[k][1])}</label></div></section>`).join('')}
    <section class="card"><h2>Alerts</h2><div class="grid2">
      <label class="f" style="margin:0"><span>Low (hypo) below</span>${inp('hypo', S.hypo)}</label>
      <label class="f" style="margin:0"><span>Very high from</span>${inp('hyper', S.hyper)}</label></div></section>
    <div class="err" id="tg-err"></div>
    <button class="btn primary block">Save targets</button></form>`;
  $('#tg').onsubmit = (e) => {
    e.preventDefault();
    const get = (id) => fromInput(parseFloat($('#' + id).value), u);
    const t = {};
    for (const k of Object.keys(TARGET_GROUPS)) {
      t[k] = [get('lo-' + k), get('hi-' + k)];
      if (!(t[k][0] > 0 && t[k][1] > t[k][0])) return ($('#tg-err').textContent = `Check the range for "${TARGET_GROUPS[k].label}".`);
    }
    S.targets = t; S.hypo = get('hypo'); S.hyper = get('hyper');
    persist(); toast('Targets saved'); location.hash = '#/settings';
  };
}

function changePwForm() {
  openSheet(`<h3>Change password</h3><form id="pf">
    <label class="f"><span>Current password</span>${pwField('p-old', 'Current password', 'current-password')}</label>
    <label class="f"><span>New password (min 8)</span>${pwField('p-new', 'New password', 'new-password')}</label>
    <label class="f"><span>Confirm new password</span>${pwField('p-new2', 'Repeat new password', 'new-password')}</label>
    <div class="err" id="p-err"></div><button class="btn primary block" id="p-go">Change password</button></form>`, (s) => {
    bindEyes(s);
    $('#pf', s).onsubmit = async (e) => {
      e.preventDefault();
      const n = $('#p-new', s).value;
      if (n.length < 8) return ($('#p-err', s).textContent = 'At least 8 characters.');
      if (n !== $('#p-new2', s).value) return ($('#p-err', s).textContent = 'Passwords don\'t match.');
      $('#p-go', s).disabled = true;
      try { await vault.changePassword($('#p-old', s).value, n); closeSheet(); toast('Password changed'); }
      catch (ex) { $('#p-err', s).textContent = ex.message; $('#p-go', s).disabled = false; }
    };
  });
}

function backupFlow() {
  openSheet(`<h3>Encrypted backup</h3>
    <p class="muted small">Choose a password for this backup file. You'll need it to restore. Keep the file somewhere safe (Google Drive, email to yourself, etc.). Without the password nobody can read it.</p>
    <form id="bf"><label class="f"><span>Backup password</span>${pwField('b-pw', 'Backup password', 'new-password')}</label>
    <label class="f"><span>Confirm</span>${pwField('b-pw2', 'Repeat', 'new-password')}</label>
    <div class="err" id="b-err"></div><button class="btn primary block" id="b-go">Download backup</button></form>`, (s) => {
    bindEyes(s);
    $('#bf', s).onsubmit = async (e) => {
      e.preventDefault();
      const p = $('#b-pw', s).value;
      if (p.length < 8) return ($('#b-err', s).textContent = 'At least 8 characters.');
      if (p !== $('#b-pw2', s).value) return ($('#b-err', s).textContent = 'Passwords don\'t match.');
      $('#b-go', s).disabled = true; $('#b-go', s).textContent = 'Encrypting…';
      const file = await vault.exportBackup(D, p);
      download(`personal-assistant-backup-${dayKey(new Date())}.hmbackup`, JSON.stringify(file), 'application/octet-stream');
      D.settings.lastBackup = Date.now(); persist();
      closeSheet(); toast('Backup downloaded');
    };
  });
}

function restoreFlow(fromSetup) {
  openSheet(`<h3>Restore backup</h3>
    <p class="muted small">${fromSetup ? 'After restoring you\'ll create a new username and password for this device.' : 'This replaces all current data on this device with the backup.'}</p>
    <form id="rf">
      <label class="f"><span>Backup file</span><input class="input" type="file" id="r-file" accept=".hmbackup,.json,application/octet-stream" required></label>
      <label class="f"><span>Backup password</span>${pwField('r-pw', 'Backup password', 'off')}</label>
      ${fromSetup ? `<label class="f"><span>New username</span><input class="input" id="r-user" autocapitalize="none" required></label>
        <label class="f"><span>New app password (min 8)</span>${pwField('r-apw', 'App password', 'new-password')}</label>` : ''}
      <div class="err" id="r-err"></div><button class="btn primary block" id="r-go">Restore</button></form>`, (s) => {
    bindEyes(s);
    $('#rf', s).onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#r-err', s);
      try {
        const f = $('#r-file', s).files[0];
        const data = await vault.importBackup(JSON.parse(await f.text()), $('#r-pw', s).value);
        if (fromSetup) {
          const pw = $('#r-apw', s).value;
          if (pw.length < 8) return (err.textContent = 'App password must be at least 8 characters.');
          D = migrate(data);
          await vault.create($('#r-user', s).value, pw, D);
          startSession();
        } else {
          D = migrate(data); await vault.save(D); applyTheme();
        }
        closeSheet(); location.hash = '#/home'; render(); toast('Backup restored');
      } catch (ex) { err.textContent = ex instanceof SyntaxError ? 'That file isn\'t a valid backup.' : ex.message; }
    };
  });
}

// ================= COMMON =================
function quickAdd() {
  openSheet(`<h3>What would you like to add?</h3>
    <div class="quick" style="margin:0">
      <button data-q="g"><span class="ic blue">🩸</span>Glucose</button>
      <button data-q="expense"><span class="ic red">➖</span>Expense</button>
      <button data-q="income"><span class="ic green">➕</span>Income</button>
    </div>
    <button class="btn block" data-q="transfer" style="margin-top:10px">🔁 Transfer between accounts</button>`, (s) => {
    $$('[data-q]', s).forEach((b) => b.onclick = () => (b.dataset.q === 'g' ? glucoseForm() : txnForm(b.dataset.q)));
  });
}
function bindCommon() {
  $$('[data-act]', appEl).forEach((b) => {
    const a = b.dataset.act;
    if (a === 'add-g') b.onclick = () => glucoseForm();
    if (a === 'add-expense') b.onclick = () => txnForm('expense');
    if (a === 'add-income') b.onclick = () => txnForm('income');
    if (a === 'add-account') b.onclick = () => accountForm(null, render);
  });
  $$('[data-edit-r]', appEl).forEach((li) => li.onclick = () => glucoseForm(D.readings.find((r) => r.id === li.dataset.editR)));
  $$('[data-edit-t]', appEl).forEach((li) => li.onclick = () => { const t = D.txns.find((x) => x.id === li.dataset.editT); txnForm(t.kind, t); });
  $$('[data-edit-a]', appEl).forEach((el) => el.onclick = () => accountForm(D.accounts.find((a) => a.id === el.dataset.editA), render));
}

// ================= BOOT =================
async function boot() {
  try { await vault.load(); } catch (e) { appEl.innerHTML = `<div class="auth"><p class="center">Storage is unavailable: ${esc(e.message)}. Private browsing may block it.</p></div>`; return; }
  render();
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
boot();

// Exposed only for automated testing in development builds.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__hm = { get D() { return D; }, commit, vault };
