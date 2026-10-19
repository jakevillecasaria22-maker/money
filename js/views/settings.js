// Settings: balances, reminders, security, backup, sync, install.

import * as C from '../calc.js';
import * as D from '../dates.js';
import { html } from '../ui.js';
import { ctx } from '../context.js';
import * as notify from '../notify.js';
import { ico, pageHead } from './common.js';

/** Filled in by app.js before rendering (async facts the view needs). */
export const env = {
  server: null,          // /api/info response or null
  syncConfigured: false,
  syncStatus: null,
  pushEnabled: false,
  persisted: null,
  storage: null,
  lastBackup: null,
  canInstall: false,
  version: '',
};

const item = (title, value, action, label = 'Edit') => html`<div class="setting">
  <div><strong>${title}</strong><small>${value}</small></div>
  ${action ? html`<button class="btn btn-small" data-action="${action}">${label}</button>` : ''}
</div>`;

function notificationsSection(s) {
  const sup = notify.support();
  const perm = {
    granted: 'Allowed', denied: 'Blocked in browser settings', default: 'Not turned on yet', unsupported: 'Not supported in this browser',
  }[sup.permission];
  return html`<section class="card">
    <div class="card-head"><h2>${ico('bell')} Reminders and notifications</h2></div>
    ${item('Bill reminders', `${s.reminderDays} day${s.reminderDays === 1 ? '' : 's'} before due, on the due day, and daily while overdue (up to ${C.OVERDUE_REMINDER_DAYS} days)${s.notifyNames ? ' · bill names shown' : ' · bill names hidden'}`, 'reminder-settings')}
    ${item('Notifications on this device', perm, sup.permission === 'default' ? 'enable-notifications' : sup.permission === 'granted' ? 'test-notification' : null, sup.permission === 'granted' ? 'Test' : 'Turn on')}
    ${sup.permission === 'denied' ? html`<p class="small warn-text">${ico('warning')} Notifications are blocked. Allow them in the browser's site settings for this app, then reload.</p>` : ''}
    ${item('Reminders while the app is closed',
      sup.periodic ? (sup.standalone ? 'Background checks are on for the installed app (Android decides how often, about twice a day).' : 'Install the app to let it check bills in the background.') : 'This browser cannot check in the background. Reminders appear when you open the app.',
      null)}
    ${env.server && env.syncConfigured && sup.push ? item('Daily push reminders from your sync server',
      env.pushEnabled ? `On · sent at ${String(((s.reminderHour + 11) % 12) + 1)}:00 ${s.reminderHour < 12 ? 'AM' : 'PM'} on days with bills due, even when the app is closed` : 'Off. The most reliable way to get reminders on a phone.',
      env.pushEnabled ? 'disable-push' : 'enable-push', env.pushEnabled ? 'Turn off' : 'Turn on') : ''}
    ${env.pushEnabled ? html`<div class="right"><button class="btn btn-small btn-ghost" data-action="test-push">Send a test push</button></div>` : ''}
    <p class="muted small">On iPhone, notifications work only after adding the app to the Home Screen (iOS 16.4 or later).</p>
  </section>`;
}

function syncSection() {
  const st = env.syncStatus || {};
  if (!env.server) {
    return html`<section class="card"><div class="card-head"><h2>${ico('sync')} Sync between devices</h2></div>
      <p class="muted small">No sync server at this address, so your data stays on this device only. Use backups to move data, or run the included server (see README) to sync your phone and computer.</p></section>`;
  }
  if (!env.syncConfigured) {
    return html`<section class="card"><div class="card-head"><h2>${ico('sync')} Sync between devices</h2></div>
      ${env.server.vault
        ? html`<p class="small">Sync is already set up on this server from another device. Connect this device with your sync passphrase.</p>
               <button class="btn btn-primary" data-action="connect-sync">Connect this device</button>`
        : html`<p class="small">Keep your phone and computer in sync. Records are encrypted before they leave this device; the server cannot read them.</p>
               <button class="btn btn-primary" data-action="create-sync">Set up sync</button>`}
    </section>`;
  }
  const when = st.lastSync ? new Date(st.lastSync).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet';
  const label = { idle: `Up to date · last synced ${when}`, syncing: 'Syncing…', offline: st.message, error: st.message, off: 'Not connected' }[st.state] || `Last synced ${when}`;
  return html`<section class="card"><div class="card-head"><h2>${ico('sync')} Sync between devices</h2></div>
    <p class="small ${st.state === 'error' ? 'warn-text' : ''}">${label}</p>
    <div class="btn-row"><button class="btn" data-action="sync-now">Sync now</button><button class="btn btn-ghost-danger" data-action="disconnect-sync">Disconnect this device</button></div>
  </section>`;
}

export function render() {
  const s = ctx.state.settings;
  const fmt = ctx.fmt;
  const sup = notify.support();
  const paydays = C.getPaydays(ctx.state);
  return html`
    ${pageHead('Settings')}
    <div class="grid">
      <div class="col">
        <section class="card">
          <div class="card-head"><h2>${ico('wallet')} Money basics</h2></div>
          ${item('Starting balances', s.openingDate ? `${fmt(s.openingCash)} cash · ${fmt(s.openingSavings)} savings, as of ${D.fmtLong(s.openingDate)}` : 'Not set. Your balance starts at zero.', 'opening-balance')}
          ${item('Currency and pay schedule', `${s.currency} · paydays on the ${paydays.map(D.ordinal).join(' & ')}`, 'general-settings')}
          ${item('Savings plan and goal', `${s.savingsPerPayday ? `${fmt(s.savingsPerPayday)} each payday` : 'No plan'}${s.goalTarget ? ` · goal ${fmt(s.goalTarget)}` : ''}`, 'savings-plan')}
          ${item('Monthly budgets', `${Object.keys(s.budgets || {}).length} categories with a budget`, 'edit-budgets')}
        </section>
        ${notificationsSection(s)}
        <section class="card">
          <div class="card-head"><h2>${ico('shield')} Security</h2></div>
          <p class="small muted">Everything is encrypted on this device with a key protected by your PIN. Without the PIN the data cannot be read.</p>
          ${item('PIN', 'Used to unlock the app', 'change-pin', 'Change')}
          ${item('Auto-lock', `After ${s.autoLockMinutes} minute${s.autoLockMinutes === 1 ? '' : 's'} without use, and when the app is in the background that long`, 'security-settings')}
          <div class="right"><button class="btn" data-action="lock">${ico('lock')} Lock now</button></div>
        </section>
      </div>
      <div class="col">
        <section class="card">
          <div class="card-head"><h2>${ico('download')} Backup and restore</h2></div>
          <p class="small muted">A backup is a single file, encrypted with a password you choose. Keep it somewhere safe (e.g. Google Drive or a USB drive). Restoring never deletes data and never creates duplicates.</p>
          <p class="small">Last backup from this device: ${env.lastBackup ? new Date(env.lastBackup).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}</p>
          <div class="btn-row"><button class="btn btn-primary" data-action="backup">${ico('download')} Download backup</button><button class="btn" data-action="restore">${ico('upload')} Restore</button></div>
        </section>
        ${syncSection()}
        <section class="card">
          <div class="card-head"><h2>${ico('phone')} Install the app</h2></div>
          ${sup.standalone ? html`<p class="small">${ico('good')} Running as an installed app.</p>`
            : env.canInstall ? html`<p class="small">Install Money Tracker for an app icon, full-screen use and background reminders.</p><button class="btn btn-primary" data-action="install">Install</button>`
            : html`<ul class="bullets small">
                <li><strong>Android (Chrome):</strong> menu ⋮ → <em>Install app</em> or <em>Add to Home screen</em>.</li>
                <li><strong>iPhone (Safari):</strong> Share → <em>Add to Home Screen</em>.</li>
                <li><strong>Computer (Chrome or Edge):</strong> click the install icon in the address bar.</li>
              </ul><p class="muted small">Installing needs the app to be opened over HTTPS (or on this computer at localhost).</p>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Storage on this device</h2></div>
          <p class="small">${env.persisted ? html`${ico('good')} Protected from automatic clean-up by the browser.` : 'The browser may clear this data if the device runs low on space. Installing the app and keeping backups protects you.'}</p>
          ${env.storage ? html`<p class="small muted">${ctx.state.expenses.length + ctx.state.income.length + ctx.state.billPayments.length + ctx.state.savings.length} transactions · about ${Math.max(1, Math.round(env.storage.usage / 1024))} KB used</p>` : ''}
          ${env.persisted === false ? html`<button class="btn btn-small" data-action="persist">Protect storage</button>` : ''}
        </section>
        <section class="card danger-zone">
          <div class="card-head"><h2>Erase this device</h2></div>
          <p class="small muted">Permanently removes all Money Tracker data from this device. Data on your sync server and in backup files is not affected.</p>
          <button class="btn btn-ghost-danger" data-action="erase-device">Erase all data on this device</button>
        </section>
        <p class="muted small center">Money Tracker ${env.version}</p>
      </div>
    </div>`;
}
