// App shell: routing, rendering, event delegation, lock/unlock, sync and reminder wiring.

import * as store from './store.js';
import * as sync from './sync.js';
import * as notify from './notify.js';
import * as idb from './db.js';
import * as C from './calc.js';
import * as D from './dates.js';
import { toCents } from './money.js';
import { $, $$, toast, confirmDialog, openForm, initTooltips, downloadText, closeAllDialogs } from './ui.js';
import { icon } from './icons.js';
import { ctx, ui, mountCharts, resetCharts } from './context.js';
import * as F from './forms.js';
import * as home from './views/home.js';
import * as money from './views/money.js';
import * as bills from './views/bills.js';
import * as plan from './views/plan.js';
import * as insights from './views/insights.js';
import * as settings from './views/settings.js';
import * as gate from './views/lock.js';
import { shiftMonth } from './views/common.js';

const VERSION = '1.0.0';
const VIEWS = { home, money, bills, plan, insights, settings };
const main = $('#main');
let deferredInstall = null;
let lastActivity = Date.now();
let hiddenAt = null;
let renderedDay = D.todayISO();
let renderQueued = false;

// ------------------------------------------------------------------ rendering

function parseRoute() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [page, sub] = path.split('/');
  return { page: VIEWS[page] ? page : 'home', sub };
}

async function loadSettingsEnv() {
  const env = settings.env;
  env.server = await sync.serverInfo();
  env.syncConfigured = await sync.isConfigured();
  env.syncStatus = sync.getStatus();
  env.pushEnabled = !!(await idb.getMeta('pushEnabled')) && !!(await notify.pushSubscription().catch(() => null));
  env.persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  env.storage = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  env.lastBackup = await idb.getMeta('lastBackup');
  env.canInstall = !!deferredInstall;
  env.version = VERSION;
}

async function render() {
  document.body.classList.toggle('locked', !store.isUnlocked());
  if (!store.isUnlocked()) return renderGate();
  const route = parseRoute();
  if (route.page === 'settings') await loadSettingsEnv();
  if (!store.isUnlocked()) return renderGate();
  resetCharts();
  main.innerHTML = String(VIEWS[route.page].render(route));
  mountCharts(main);
  for (const a of $$('[data-nav]')) {
    const on = a.dataset.nav === route.page;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  renderedDay = D.todayISO();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}

async function renderGate() {
  if (await store.hasVault()) {
    main.innerHTML = String(gate.lockScreen());
  } else {
    const info = await sync.serverInfo();
    main.innerHTML = String(gate.welcome({ syncAvailable: !!info?.vault }));
  }
  const first = $('input', main);
  if (first && matchMedia('(pointer: fine)').matches) first.focus();
}

const closeDialogs = closeAllDialogs;

// ------------------------------------------------------------------ after unlock / data changes

let digestTimer = null;
function scheduleDigest() {
  clearTimeout(digestTimer);
  digestTimer = setTimeout(() => {
    if (store.isUnlocked()) notify.updateDigest(store.state, ctx.today).catch(() => {});
  }, 1200);
}

async function afterUnlock() {
  await sync.syncNow();
  if (!store.isUnlocked()) return;
  notify.notifyDueBills(store.state, ctx.today).catch(() => {});
  notify.registerPeriodic().catch(() => {});
}

store.onChange((source) => {
  if (source === 'lock') { closeDialogs(); render(); return; }
  if (source === 'unlock') { render(); afterUnlock(); return; }
  scheduleRender();
  if (source === 'local') sync.scheduleSync();
  scheduleDigest();
});

sync.onStatus((st) => {
  const el = $('#sync-indicator');
  if (!el) return;
  const map = { syncing: ['sync', 'Syncing…', 'spin'], offline: ['cloudOff', 'Offline · changes saved on this device', ''], error: ['warning', st.message || 'Sync problem', 'warn'], idle: ['sync', 'Synced', 'ok'] };
  const m = map[st.state];
  el.hidden = !m;
  if (m) {
    el.innerHTML = icon(m[0]);
    el.className = `sync-ind ${m[2]}`;
    el.title = m[1];
    el.setAttribute('aria-label', m[1]);
  }
  if (parseRoute().page === 'settings' && st.state !== 'syncing' && store.isUnlocked() && !$('dialog[open]')) scheduleRender();
});

// ------------------------------------------------------------------ lookups

const byId = (coll, id) => store.state[coll].find((x) => x.id === id);
const findOccurrence = (key) => C.billSchedule(store.state, D.addDays(ctx.today, 800), ctx.today).find((o) => o.key === key);
function findIncomeOccurrence(key) {
  const date = key.split('|')[1];
  return C.expectedIncome(store.state, date, date).find((o) => o.key === key);
}

// ------------------------------------------------------------------ flows

async function onboarding() {
  await openForm({
    title: 'Set up your money',
    intro: 'A few details so your balance and paydays are right. You can change all of this later in Settings.',
    values: { currency: 'PHP', openingDate: ctx.today, paydays: [5, 20] },
    fields: [
      { name: 'currency', label: 'Currency', type: 'select', options: ['PHP', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'AUD', 'CAD', 'AED', 'SAR', 'HKD', 'KRW'].map((c) => ({ key: c, label: c })) },
      { name: 'openingCash', label: 'Money you have now (cash, bank, e-wallets)', type: 'money', currencySymbol: '', required: true, min: 0, autofocus: true },
      { name: 'openingSavings', label: 'Money already in savings (optional)', type: 'money', currencySymbol: '', min: 0 },
      { name: 'paydays', label: 'Paydays', type: 'days', required: true, hint: 'Default: the 5th and 20th.' },
      { name: 'salary', label: 'Salary you receive each payday (optional)', type: 'money', currencySymbol: '', min: 1 },
    ],
    submitLabel: 'Save and continue',
    onSubmit: async (v) => {
      await store.saveSettings({ currency: v.currency, openingDate: ctx.today, openingCash: v.openingCash || 0, openingSavings: v.openingSavings || 0, paydays: v.paydays });
      if (v.salary) await store.save({ type: 'incomeSource', name: 'Salary', kind: 'salary', freq: 'monthly', days: v.paydays, amount: v.salary, active: true });
    },
  });
}

function pinErrors(v, a = 'pin', b = 'pin2') {
  if ((v[a] || '').length < 6) return { [a]: 'Use at least 6 digits or characters' };
  if (v[a] !== v[b]) return { [b]: 'PINs do not match' };
  return {};
}

async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

async function eraseFlow() {
  const v = await openForm({
    title: 'Erase this device',
    intro: 'This permanently deletes all Money Tracker data stored on this device. Your sync server and backup files are not affected.',
    fields: [{ name: 'confirm', label: 'Type ERASE to confirm', type: 'text', required: true }],
    validate: (x) => (x.confirm !== 'ERASE' ? { confirm: 'Type ERASE in capital letters' } : {}),
    submitLabel: 'Erase',
  });
  if (!v) return;
  await notify.disablePush().catch(() => {});
  await store.eraseDevice();
  location.hash = '#/home';
  location.reload();
}

const actions = {
  'quick-add': () => F.quickAdd(),
  'add-expense': () => F.expenseForm(),
  'edit-expense': (d) => F.expenseForm(byId('expenses', d.id)),
  'add-income': () => F.incomeForm(),
  'edit-income': (d) => F.incomeForm(byId('income', d.id)),
  'receive-income': (d) => { const o = findIncomeOccurrence(d.key); if (o) F.incomeForm(null, o); },
  'add-income-source': () => F.incomeSourceForm(),
  'edit-income-source': (d) => F.incomeSourceForm(byId('incomeSources', d.id)),
  'add-bill': () => F.billForm(),
  'edit-bill': (d) => F.billForm(byId('bills', d.id)),
  'pay-bill': (d) => { const o = findOccurrence(d.key); if (o) F.payBillForm(o); },
  'edit-payment': (d) => { const p = byId('billPayments', d.id); if (p) F.payBillForm(null, p); },
  'add-savings': () => F.savingsForm(null, 'deposit'),
  'withdraw-savings': () => F.savingsForm(null, 'withdraw'),
  'edit-savings': (d) => F.savingsForm(byId('savings', d.id)),
  'add-purchase': () => F.purchaseForm(),
  'edit-purchase': (d) => F.purchaseForm(byId('purchases', d.id)),
  'bought-purchase': (d) => F.markBoughtForm(byId('purchases', d.id)),
  'postpone-purchase': async (d) => { await store.save({ ...byId('purchases', d.id), status: 'postponed' }); toast('Postponed'); },
  'resume-purchase': async (d) => { await store.save({ ...byId('purchases', d.id), status: 'planned' }); toast('Back on the plan'); },
  'edit-budgets': () => F.budgetForm(),
  'apply-recommended-budget': async () => {
    const ins = C.insights(store.state, ctx.today);
    const budgets = Object.fromEntries((ins.categories || []).filter((r) => r.recommended > 0).map((r) => [r.key, r.recommended]));
    if (!Object.keys(budgets).length) return;
    const ok = await confirmDialog({ title: 'Use the recommended budget?', message: 'Your monthly budgets will be replaced with the recommended amounts. You can edit them any time.', confirmLabel: 'Use these budgets' });
    if (ok) { await store.saveSettings({ budgets }); toast('Budgets updated', { type: 'success' }); }
  },
  'opening-balance': () => F.openingBalanceForm(),
  'general-settings': () => F.generalSettingsForm(),
  'savings-plan': () => F.savingsPlanForm(),
  'reminder-settings': () => F.reminderSettingsForm(),
  'security-settings': () => F.securityForm(),
  'change-pin': () => F.changePinForm(),
  'expense-month': (d) => { ui.expenseMonth = shiftMonth(ui.expenseMonth || ctx.today, Number(d.delta)); render(); },
  'income-month': (d) => { ui.incomeMonth = shiftMonth(ui.incomeMonth || ctx.today, Number(d.delta)); render(); },
  'history-month': (d) => { ui.historyMonth = shiftMonth(ui.historyMonth || ctx.today, Number(d.delta)); render(); },
  'spend-unit': (d) => { ui.spendUnit = d.unit; render(); },
  'breakdown-range': (d) => { ui.breakdownRange = d.range; render(); },
  lock: () => store.lock(),

  'enable-notifications': async () => {
    const r = await notify.requestPermission();
    if (r === 'granted') {
      toast('Notifications are on', { type: 'success' });
      await idb.delMeta('lastNotified');
      await notify.notifyDueBills(store.state, ctx.today);
    } else toast(r === 'denied' ? 'Notifications were blocked' : 'Notifications not enabled', { type: 'warning' });
    render();
  },
  'test-notification': () => notify.testNotification(),
  'enable-push': async () => {
    if (notify.support().permission !== 'granted' && (await notify.requestPermission()) !== 'granted') {
      toast('Allow notifications first', { type: 'warning' });
      return;
    }
    await notify.enablePush(store.state, ctx.today);
    toast('Push reminders are on', { type: 'success' });
    render();
  },
  'disable-push': async () => { await notify.disablePush(); toast('Push reminders are off'); render(); },
  'test-push': async () => {
    const r = await notify.testPush();
    toast(r.status >= 200 && r.status < 300 ? 'Test push sent. It should arrive in a few seconds.' : `Push service answered ${r.status}`);
  },

  backup: async () => {
    const v = await openForm({
      title: 'Download encrypted backup',
      intro: 'Choose a password for this backup file. You will need it to restore. It can be different from your PIN.',
      fields: [
        { name: 'pw', label: 'Backup password (at least 8 characters)', type: 'password', required: true },
        { name: 'pw2', label: 'Repeat password', type: 'password', required: true },
      ],
      validate: (x) => (x.pw.length < 8 ? { pw: 'Use at least 8 characters' } : x.pw !== x.pw2 ? { pw2: 'Passwords do not match' } : {}),
      submitLabel: 'Download',
      onSubmit: async (x) => {
        const blob = await store.exportBackup(x.pw);
        downloadText(`money-tracker-backup-${ctx.today}.json`, JSON.stringify(blob));
        await idb.setMeta('lastBackup', Date.now());
        return blob;
      },
    });
    if (v) { toast('Backup downloaded', { type: 'success' }); render(); }
  },
  restore: async () => {
    const r = await openForm({
      title: 'Restore from backup',
      intro: 'Brings back records from the backup that are missing or were deleted here. Where a record exists in both, the more recently edited version is kept. Nothing is deleted and nothing is duplicated.',
      fields: [
        { name: 'file', label: 'Backup file', type: 'file', accept: '.json,application/json', required: true },
        { name: 'pw', label: 'Backup password', type: 'password', autocomplete: 'current-password', required: true },
      ],
      submitLabel: 'Restore',
      onSubmit: async (x) => store.restoreRecords((await store.readBackup(x.file, x.pw)).records),
    });
    if (r) toast(`Restore complete: ${r.added} added, ${r.restored} brought back, ${r.updated} updated, ${r.unchanged} already up to date.`, { type: 'success', timeout: 7000 });
  },

  'create-sync': async () => {
    const info = await sync.serverInfo();
    const r = await openForm({
      title: 'Set up sync',
      intro: 'Choose a sync passphrase. You will enter it once on each other device. Write it down: it cannot be recovered.',
      fields: [
        { name: 'pass', label: 'Sync passphrase (at least 10 characters)', type: 'password', required: true },
        { name: 'pass2', label: 'Repeat passphrase', type: 'password', required: true },
        ...(info?.setupCodeRequired ? [{ name: 'code', label: 'Server setup code (MT_SETUP_CODE)', type: 'password', autocomplete: 'off', required: true }] : []),
      ],
      validate: (x) => (x.pass.length < 10 ? { pass: 'Use at least 10 characters' } : x.pass !== x.pass2 ? { pass2: 'Passphrases do not match' } : {}),
      submitLabel: 'Set up sync',
      onSubmit: async (x) => { await sync.createSync(x.pass, x.code); return true; },
    });
    if (r) { toast('Sync is on', { type: 'success' }); render(); }
  },
  'connect-sync': async () => {
    if (store.recordCount() > 0) {
      await confirmDialog({
        title: 'This device already has records',
        message: 'To join your synced data without mixing two separate setups: 1) download a backup here, 2) erase this device, 3) choose "Connect to my synced data" on the welcome screen, 4) restore the backup. Restoring merges without duplicates.',
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return;
    }
    const r = await openForm({
      title: 'Connect this device',
      intro: 'Your synced records will be downloaded and kept in sync. Settings made on this device so far are replaced by the synced ones.',
      fields: [
        { name: 'pass', label: 'Sync passphrase', type: 'password', autocomplete: 'current-password', required: true },
        { name: 'pin', label: 'Your PIN on this device', type: 'password', autocomplete: 'current-password', required: true },
      ],
      submitLabel: 'Connect',
      onSubmit: async (x) => {
        const { dek, token } = await sync.fetchSharedKey(x.pass);
        await store.replaceVault(x.pin, dek);
        await sync.connectWithToken(token);
        return true;
      },
    });
    if (r) toast('Connected. Syncing…', { type: 'success' });
  },
  'sync-now': async () => { await sync.syncNow(); const st = sync.getStatus(); toast(st.state === 'idle' ? 'Synced' : st.message, { type: st.state === 'idle' ? 'success' : 'warning' }); },
  'disconnect-sync': async () => {
    const ok = await confirmDialog({ title: 'Disconnect this device from sync?', message: 'Your data stays on this device and on the server. Changes will no longer sync until you connect again.', confirmLabel: 'Disconnect', danger: true });
    if (!ok) return;
    await notify.disablePush().catch(() => {});
    await sync.disconnect();
    render();
  },
  install: async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
    render();
  },
  persist: async () => { toast((await requestPersistence()) ? 'Storage protected' : 'The browser did not allow it. Installing the app usually helps.'); render(); },
  'erase-device': () => eraseFlow(),

  'gate-restore': async () => {
    const r = await openForm({
      title: 'Restore from a backup',
      fields: [
        { name: 'file', label: 'Backup file', type: 'file', accept: '.json,application/json', required: true },
        { name: 'pw', label: 'Backup password', type: 'password', autocomplete: 'current-password', required: true },
        { name: 'pin', label: 'New PIN for this device (at least 6)', type: 'password', required: true },
        { name: 'pin2', label: 'Repeat PIN', type: 'password', required: true },
      ],
      validate: (x) => pinErrors(x),
      submitLabel: 'Restore',
      onSubmit: async (x) => {
        const { records } = await store.readBackup(x.file, x.pw);
        await store.createVault(x.pin);
        await requestPersistence();
        return store.restoreRecords(records);
      },
    });
    if (r) toast(`Restored ${r.added + r.restored + r.updated} records`, { type: 'success' });
  },
  'gate-join': async () => {
    const r = await openForm({
      title: 'Connect to my synced data',
      fields: [
        { name: 'pass', label: 'Sync passphrase', type: 'password', autocomplete: 'current-password', required: true },
        { name: 'pin', label: 'New PIN for this device (at least 6)', type: 'password', required: true },
        { name: 'pin2', label: 'Repeat PIN', type: 'password', required: true },
      ],
      validate: (x) => pinErrors(x),
      submitLabel: 'Connect',
      onSubmit: async (x) => { await sync.joinSync(x.pass, x.pin); await requestPersistence(); return true; },
    });
    if (r) toast('Connected. Your records are syncing.', { type: 'success' });
  },
  'forgot-pin': async () => {
    const ok = await confirmDialog({
      title: 'Forgot your PIN?',
      message: 'For your security the PIN cannot be reset or bypassed. You can erase this device and then restore from a backup file or reconnect to your synced data.',
      confirmLabel: 'Erase this device…',
      danger: true,
    });
    if (ok) eraseFlow();
  },
};

const submits = {
  'create-vault': async (form) => {
    const v = { pin: form.pin.value, pin2: form.pin2.value };
    const err = pinErrors(v);
    if (Object.keys(err).length) throw new Error(Object.values(err)[0]);
    await store.createVault(v.pin);
    await requestPersistence();
    location.hash = '#/home';
    await onboarding();
  },
  unlock: async (form) => {
    await store.unlock(form.pin.value);
  },
  afford: (form) => {
    const input = form.price.value;
    const price = toCents(input);
    if (!(price > 0)) { ui.affordResult = { input, ok: false, message: 'Enter a price, e.g. 1500' }; render(); return; }
    const chk = C.checkAffordability(store.state, ctx.today, price);
    ui.affordResult = { input, ok: chk.ok, message: plan.affordMessage(chk, price, ctx.fmt) };
    render();
  },
};

const changes = {
  'expense-filter': (el) => { ui.expenseFilter = el.value; render(); },
};

// ------------------------------------------------------------------ events

function runAction(el) {
  const fn = actions[el.dataset.action];
  if (!fn) return;
  Promise.resolve(fn(el.dataset, el)).catch((e) => toast(e.message || String(e), { type: 'error', timeout: 6000 }));
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.tagName === 'A') e.preventDefault();
  runAction(el);
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action]')) {
    e.preventDefault();
    runAction(e.target);
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  const err = $('.form-error', form);
  const btn = $('button[type="submit"]', form);
  if (err) err.textContent = '';
  if (btn) btn.disabled = true;
  try {
    await submits[form.dataset.submit](form);
  } catch (ex) {
    if (err) err.textContent = ex.message;
    else toast(ex.message, { type: 'error' });
    const pin = form.querySelector('input[type="password"]');
    if (pin && form.dataset.submit === 'unlock') { pin.value = ''; pin.focus(); }
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el) changes[el.dataset.change]?.(el);
});

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => store.isUnlocked() && mountCharts(main), 150);
});

for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true });
}

const lockAfterMs = () => (store.state.settings.autoLockMinutes || 5) * 60000;

setInterval(() => {
  if (!store.isUnlocked()) return;
  if (Date.now() - lastActivity > lockAfterMs()) { store.lock(); return; }
  if (D.todayISO() !== renderedDay && !$('dialog[open]')) render();
}, 15000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (store.isUnlocked() && hiddenAt && Date.now() - hiddenAt > lockAfterMs()) store.lock();
  hiddenAt = null;
  lastActivity = Date.now();
  if (store.isUnlocked()) {
    sync.syncNow();
    notify.notifyDueBills(store.state, ctx.today).catch(() => {});
    if (D.todayISO() !== renderedDay) render();
  }
});

window.addEventListener('online', () => { if (store.isUnlocked()) sync.syncNow(); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) toast(e.reason.message, { type: 'error' }); });

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (parseRoute().page === 'settings' && store.isUnlocked()) render();
});
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('Money Tracker installed', { type: 'success' }); });

// ------------------------------------------------------------------ service worker

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => {
      const banner = $('#update-banner');
      banner.hidden = false;
      $('button', banner).onclick = () => worker.postMessage('skip-waiting');
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !$('#update-banner') || $('#update-banner').hidden) return;
    reloading = true;
    location.reload();
  });
}

// ------------------------------------------------------------------ boot

function boot() {
  for (const el of $$('[data-icon]')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  initTooltips();
  registerServiceWorker();
  render();
}

boot();
