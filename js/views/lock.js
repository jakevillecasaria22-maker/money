// Welcome (first run) and lock screens.

import { html } from '../ui.js';
import { ico } from './common.js';

export function welcome({ syncAvailable }) {
  return html`<div class="gate">
    <div class="gate-card">
      <img src="icons/icon-192.png" alt="" width="64" height="64" class="gate-logo">
      <h1>Money Tracker</h1>
      <p class="muted">Track your salary, bills, spending and savings, and see how much you can safely spend until payday.</p>
      <form data-submit="create-vault" class="gate-form" autocomplete="off">
        <h2>Create a PIN</h2>
        <p class="small muted">Your records are encrypted on this device with this PIN. Use at least 6 digits or characters. If you forget it, the data can only be recovered from a backup or sync.</p>
        <label for="pin">PIN</label>
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="new-password" required minlength="6">
        <label for="pin2">Repeat PIN</label>
        <input id="pin2" name="pin2" type="password" inputmode="numeric" autocomplete="new-password" required minlength="6">
        <p class="form-error" role="alert"></p>
        <button class="btn btn-primary btn-block" type="submit">Start</button>
      </form>
      <div class="gate-links">
        <button class="link" data-action="gate-restore">${ico('upload')} Restore from a backup file</button>
        ${syncAvailable ? html`<button class="link" data-action="gate-join">${ico('sync')} Connect to my synced data</button>` : ''}
      </div>
    </div>
  </div>`;
}

export function lockScreen() {
  return html`<div class="gate">
    <div class="gate-card">
      <img src="icons/icon-192.png" alt="" width="64" height="64" class="gate-logo">
      <h1>Money Tracker</h1>
      <form data-submit="unlock" class="gate-form" autocomplete="off">
        <label for="pin">Enter your PIN</label>
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required autofocus>
        <p class="form-error" role="alert"></p>
        <button class="btn btn-primary btn-block" type="submit">${ico('lock')} Unlock</button>
      </form>
      <div class="gate-links"><button class="link" data-action="forgot-pin">Forgot PIN?</button></div>
    </div>
  </div>`;
}
