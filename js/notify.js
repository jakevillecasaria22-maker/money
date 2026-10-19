// Bill reminders and budget warnings as system notifications.
// Three delivery paths, each used where the device supports it:
//   1. In-app: checked whenever the app is opened or unlocked.
//   2. Periodic Background Sync (installed app on Android Chrome): the service worker checks
//      the stored reminder list about twice a day, even when the app is closed.
//   3. Web Push from the sync server (if connected): a daily wake-up on reminder days.
// All three read the same amount-free reminder digest, and at most one bill notification is
// shown per day (same tag, so a later one replaces an earlier one).

import * as idb from './db.js';
import { reminderDigest, reminderDates, digestSummary } from './calc.js';
import { b64u } from './crypto.js';
import * as sync from './sync.js';

export function support() {
  const hasSW = 'serviceWorker' in navigator;
  return {
    notifications: 'Notification' in window && hasSW,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    periodic: hasSW && 'periodicSync' in ServiceWorkerRegistration.prototype,
    push: hasSW && 'PushManager' in window,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  };
}

const registration = async () => ('serviceWorker' in navigator ? navigator.serviceWorker.ready : null);

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') await registerPeriodic();
  return result;
}

export async function registerPeriodic() {
  try {
    const reg = await registration();
    if (!reg?.periodicSync) return false;
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state !== 'granted') return false;
    await reg.periodicSync.register('bill-reminders', { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

export function billMessage(sum, includeNames) {
  const parts = [];
  if (sum.overdue.length) parts.push(`${sum.overdue.length} overdue`);
  if (sum.today.length) parts.push(`${sum.today.length} due today`);
  if (sum.soon.length) parts.push(`${sum.soon.length} due soon`);
  if (!parts.length) return null;
  const all = [...sum.overdue, ...sum.today, ...sum.soon];
  const names = includeNames ? all.map((i) => i.name).filter(Boolean) : [];
  return {
    title: `Bills: ${parts.join(', ')}`,
    body: names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '') : 'Open Money Tracker to review and mark them paid.',
  };
}

/** Saves the reminder digest for the service worker and refreshes the push schedule. */
export async function updateDigest(state, today) {
  const digest = reminderDigest(state, today, !!state.settings.notifyNames);
  await idb.setMeta('digest', digest);
  await updatePushSchedule(state, today, digest).catch(() => {});
  return digest;
}

/** Shows today's bill notification once per day (when permitted). */
export async function notifyDueBills(state, today) {
  const digest = await updateDigest(state, today);
  if (support().permission !== 'granted') return false;
  if ((await idb.getMeta('lastNotified')) === today) return false;
  const msg = billMessage(digestSummary(digest, today), !!state.settings.notifyNames);
  if (!msg) return false;
  const reg = await registration();
  await reg.showNotification(msg.title, { body: msg.body, tag: 'bill-reminder', icon: 'icons/icon-192.png', badge: 'icons/badge-72.png', data: { url: './#/bills' } });
  await idb.setMeta('lastNotified', today);
  return true;
}

export async function notifyBudget(rows, fmt) {
  if (support().permission !== 'granted' || !rows.length) return;
  const reg = await registration();
  for (const r of rows) {
    const over = r.status === 'over';
    await reg.showNotification(over ? `Over budget: ${r.label}` : `Approaching budget: ${r.label}`, {
      body: `${fmt(r.spent)} of ${fmt(r.budget)} spent this month (${Math.round(r.pct * 100)}%).`,
      tag: `budget-${r.key}`,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-72.png',
      data: { url: './#/plan/budget' },
    });
  }
}

export async function testNotification() {
  const reg = await registration();
  await reg.showNotification('Money Tracker notifications are on', { body: 'Bill reminders will appear like this.', tag: 'test', icon: 'icons/icon-192.png', badge: 'icons/badge-72.png' });
}

// ------------------------------------------------------------------ web push (sync server)

export async function pushSubscription() {
  const reg = await registration();
  return reg?.pushManager ? reg.pushManager.getSubscription() : null;
}

export async function enablePush(state, today) {
  const info = await sync.serverInfo();
  if (!info?.vapidPublicKey) throw new Error('Push needs the sync server.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u.decode(info.vapidPublicKey) });
  await idb.setMeta('pushEnabled', true);
  await updatePushSchedule(state, today, await idb.getMeta('digest') || reminderDigest(state, today, false));
  return sub;
}

export async function disablePush() {
  const sub = await pushSubscription();
  if (sub) {
    await sync.pushRequest('push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  await idb.delMeta('pushEnabled');
}

async function updatePushSchedule(state, today, digest) {
  if (!(await idb.getMeta('pushEnabled')) || !(await sync.isConfigured())) return;
  const sub = await pushSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  await sync.pushRequest('push/subscribe', {
    subscription: { endpoint: json.endpoint, keys: json.keys },
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    hour: state.settings.reminderHour ?? 8,
    dates: reminderDates(digest, today),
  });
}

export async function testPush() {
  const sub = await pushSubscription();
  if (!sub) throw new Error('Push is not enabled on this device.');
  return sync.pushRequest('push/test', { endpoint: sub.endpoint });
}
