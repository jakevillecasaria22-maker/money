// UI helpers: escaped HTML templates, dialogs, form builder, toasts, tooltips.

import { toCents, centsToInput } from './money.js';
import { isISODate } from './dates.js';
import { icon } from './icons.js';

// ------------------------------------------------------------------ templating

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function out(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(out).join('');
  if (v == null || v === false || v === true) return '';
  return esc(v);
}

/** Tagged template: every interpolated value is HTML-escaped unless wrapped with raw()/html``. */
export function html(strings, ...vals) {
  let s = strings[0];
  for (let i = 0; i < vals.length; i++) s += out(vals[i]) + strings[i + 1];
  return new Raw(s);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ toast

export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, timeout);
}

// ------------------------------------------------------------------ dialogs

/** Creates a modal dialog. finish(value) closes and removes it and calls onDone(value) exactly
 *  once. Results never depend on the dialog 'close' event, which browsers may delay. */
function makeDialog(className, onDone) {
  const d = document.createElement('dialog');
  d.className = `sheet ${className}`;
  document.body.appendChild(d);
  let done = false;
  const finish = (value) => {
    if (done) return;
    done = true;
    if (d.open) d.close();
    d.remove();
    onDone(value);
  };
  d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
  d.addEventListener('close', () => finish(null));
  d.addEventListener('click', (e) => { if (e.target === d) finish(null); });
  d.finish = finish;
  return { d, finish };
}

/** Closes every open dialog as cancelled (used when the app locks). */
export function closeAllDialogs() {
  document.querySelectorAll('dialog').forEach((d) => (d.finish ? d.finish(null) : d.close()));
}

export function confirmDialog({ title, message = '', confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const { d, finish } = makeDialog('sheet-small', (v) => resolve(v === 'ok'));
    d.innerHTML = String(html`
      <div class="sheet-body">
        <h2 class="sheet-title">${title}</h2>
        ${message ? html`<p class="muted">${message}</p>` : ''}
        <div class="sheet-actions">
          <button type="button" data-value="cancel" class="btn btn-ghost">${cancelLabel}</button>
          <button type="button" data-value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmLabel}</button>
        </div>
      </div>`);
    d.querySelectorAll('[data-value]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.value)));
    d.showModal();
  });
}

/** Simple action list (used by the + button). Resolves to the chosen key or null. */
export function chooseDialog({ title, options }) {
  return new Promise((resolve) => {
    const { d, finish } = makeDialog('sheet-small', (v) => resolve(v || null));
    d.innerHTML = String(html`
      <div class="sheet-body">
        <h2 class="sheet-title">${title}</h2>
        <div class="choice-list">
          ${options.map((o) => html`<button type="button" data-value="${o.key}" class="choice">${raw(icon(o.icon || 'plus'))}<span><strong>${o.label}</strong>${o.hint ? html`<small>${o.hint}</small>` : ''}</span></button>`)}
        </div>
        <div class="sheet-actions"><button type="button" data-value="" class="btn btn-ghost">Cancel</button></div>
      </div>`);
    d.querySelectorAll('[data-value]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.value)));
    d.showModal();
  });
}

// ------------------------------------------------------------------ form builder

function fieldHTML(f, v) {
  const id = `f-${f.name}`;
  const req = f.required ? raw(' required') : '';
  const hint = f.hint ? html`<small class="hint">${f.hint}</small>` : '';
  const err = html`<small class="field-error" data-error-for="${f.name}"></small>`;
  const wrap = (inner, cls = '') => html`<div class="field ${cls}" data-field="${f.name}">${inner}${hint}${err}</div>`;
  switch (f.type) {
    case 'heading':
      return html`<h3 class="form-heading" data-field="${f.name}">${f.label}</h3>${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}`;
    case 'note':
      return html`<p class="form-note" data-field="${f.name}">${f.label}</p>`;
    case 'money':
      return wrap(html`<label for="${id}">${f.label}</label>
        <div class="money-input"><span>${f.currencySymbol || '₱'}</span>
        <input id="${id}" name="${f.name}" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${v == null || v === '' ? '' : centsToInput(v)}"${req}${f.autofocus ? raw(' autofocus') : ''}></div>`);
    case 'date':
      return wrap(html`<label for="${id}">${f.label}</label>
        <input id="${id}" name="${f.name}" type="date" value="${v || ''}"${f.max ? raw(` max="${esc(f.max)}"`) : ''}${f.min ? raw(` min="${esc(f.min)}"`) : ''}${req}>`);
    case 'select':
      return wrap(html`<label for="${id}">${f.label}</label>
        <select id="${id}" name="${f.name}"${req}>${f.options.map((o) => html`<option value="${o.key}"${String(o.key) === String(v ?? '') ? raw(' selected') : ''}>${o.label}</option>`)}</select>`);
    case 'chips':
      return wrap(html`<span class="label">${f.label}</span>
        <div class="chips" role="radiogroup">${f.options.map((o) => html`<label class="chip"><input type="radio" name="${f.name}" value="${o.key}"${String(o.key) === String(v ?? '') ? raw(' checked') : ''}><span>${o.label}</span></label>`)}</div>`);
    case 'days': {
      const set = new Set((v || []).map(Number));
      return wrap(html`<span class="label">${f.label}</span>
        <div class="day-grid">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => html`<label class="day"><input type="checkbox" name="${f.name}" value="${d}"${set.has(d) ? raw(' checked') : ''}><span>${d}</span></label>`)}</div>`);
    }
    case 'checkbox':
      return wrap(html`<label class="switch"><input type="checkbox" name="${f.name}"${v ? raw(' checked') : ''}><span class="switch-track"></span><span>${f.label}</span></label>`, 'field-inline');
    case 'textarea':
      return wrap(html`<label for="${id}">${f.label}</label><textarea id="${id}" name="${f.name}" rows="2" maxlength="500">${v || ''}</textarea>`);
    case 'number':
      return wrap(html`<label for="${id}">${f.label}</label>
        <input id="${id}" name="${f.name}" type="number" inputmode="numeric" value="${v ?? ''}"${f.min != null ? raw(` min="${f.min}"`) : ''}${f.max != null ? raw(` max="${f.max}"`) : ''}${req}>`);
    case 'password':
      return wrap(html`<label for="${id}">${f.label}</label>
        <input id="${id}" name="${f.name}" type="password" autocomplete="${f.autocomplete || 'new-password'}"${f.numeric ? raw(' inputmode="numeric"') : ''}${req}${f.autofocus ? raw(' autofocus') : ''}>`);
    case 'file':
      return wrap(html`<label for="${id}">${f.label}</label><input id="${id}" name="${f.name}" type="file" accept="${f.accept || ''}"${req}>`);
    default:
      return wrap(html`<label for="${id}">${f.label}</label>
        <input id="${id}" name="${f.name}" type="text" value="${v ?? ''}" maxlength="${f.maxlength || 120}" placeholder="${f.placeholder || ''}" autocomplete="off"${req}${f.autofocus ? raw(' autofocus') : ''}>`);
  }
}

function readValues(form, fields) {
  const v = {};
  for (const f of fields) {
    if (f.type === 'heading' || f.type === 'note') continue;
    const els = form.elements[f.name];
    if (f.type === 'money') v[f.name] = els.value.trim() === '' ? null : toCents(els.value);
    else if (f.type === 'checkbox') v[f.name] = els.checked;
    else if (f.type === 'days') v[f.name] = $$(`input[name="${f.name}"]:checked`, form).map((x) => Number(x.value));
    else if (f.type === 'chips') v[f.name] = $(`input[name="${f.name}"]:checked`, form)?.value ?? null;
    else if (f.type === 'number') v[f.name] = els.value === '' ? null : Number(els.value);
    else if (f.type === 'file') v[f.name] = els.files[0] || null;
    else if (f.type === 'password') v[f.name] = els.value;
    else v[f.name] = els.value.trim() || null;
  }
  return v;
}

function builtinErrors(fields, v, visible) {
  const errors = {};
  for (const f of fields) {
    if (!visible(f) || f.type === 'heading' || f.type === 'note') continue;
    const val = v[f.name];
    const empty = val == null || val === '' || (Array.isArray(val) && !val.length);
    if (f.required && empty) { errors[f.name] = f.type === 'days' ? 'Pick at least one day' : 'Required'; continue; }
    if (empty) continue;
    if (f.type === 'money') {
      if (Number.isNaN(val)) errors[f.name] = 'Enter an amount like 1250 or 1,250.50';
      else if (f.min != null && val < f.min) errors[f.name] = f.min > 0 ? 'Must be more than zero' : 'Cannot be negative';
      else if (Math.abs(val) > 1e13) errors[f.name] = 'Amount is too large';
    }
    if (f.type === 'date') {
      if (!isISODate(val)) errors[f.name] = 'Enter a valid date';
      else if (f.max && val > f.max) errors[f.name] = f.maxMessage || 'Date is too late';
      else if (f.min && val < f.min) errors[f.name] = f.minMessage || 'Date is too early';
    }
    if (f.type === 'number' && (!Number.isFinite(val) || (f.min != null && val < f.min) || (f.max != null && val > f.max))) {
      errors[f.name] = `Enter a number${f.min != null ? ` from ${f.min}` : ''}${f.max != null ? ` to ${f.max}` : ''}`;
    }
  }
  return errors;
}

/**
 * Opens a form in a sheet.
 * spec: { title, fields, values, submitLabel, validate(v) -> {name: msg}, onSubmit(v) (may throw),
 *         onDelete() (shows a Delete button), deleteLabel, intro }
 * Fields may have showIf(values) to toggle visibility as the user types.
 */
export function openForm(spec) {
  return new Promise((resolve) => {
    const { d, finish } = makeDialog('', resolve);
    const values = spec.values || {};
    d.innerHTML = String(html`
      <form class="sheet-body" novalidate>
        <div class="sheet-head">
          <h2 class="sheet-title">${spec.title}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">${raw(icon('x'))}</button>
        </div>
        ${spec.intro ? html`<p class="muted">${spec.intro}</p>` : ''}
        <div class="form-fields">${spec.fields.map((f) => fieldHTML(f, values[f.name]))}</div>
        <p class="form-error" role="alert"></p>
        <div class="sheet-actions">
          ${spec.onDelete ? html`<button type="button" class="btn btn-ghost-danger" data-delete>${spec.deleteLabel || 'Delete'}</button>` : ''}
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${spec.submitLabel || 'Save'}</button>
        </div>
      </form>`);
    const form = $('form', d);
    const visible = (f) => !f.showIf || f.showIf(readValues(form, spec.fields));
    const refresh = () => {
      for (const f of spec.fields) {
        const el = $(`[data-field="${f.name}"]`, form);
        if (el) el.hidden = !visible(f);
      }
    };
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    refresh();
    $$('[data-close]', form).forEach((b) => b.addEventListener('click', () => finish(null)));
    $('[data-delete]', form)?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: spec.deleteConfirm || 'Delete this record?', message: spec.deleteMessage || 'This cannot be undone.', confirmLabel: spec.deleteLabel || 'Delete', danger: true });
      if (!ok) return;
      try {
        await spec.onDelete();
        finish({ deleted: true });
      } catch (e) {
        $('.form-error', form).textContent = e.message;
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readValues(form, spec.fields);
      const errors = { ...builtinErrors(spec.fields, v, visible), ...(spec.validate?.(v) || {}) };
      $$('.field-error', form).forEach((el) => { el.textContent = errors[el.dataset.errorFor] || ''; });
      $$('.field', form).forEach((el) => el.classList.toggle('has-error', !!errors[el.dataset.field]));
      const first = Object.keys(errors)[0];
      if (first) {
        $(`[name="${first}"]`, form)?.focus();
        return;
      }
      const btn = $('button[type="submit"]', form);
      btn.disabled = true;
      $('.form-error', form).textContent = '';
      try {
        const r = spec.onSubmit ? await spec.onSubmit(v) : undefined;
        finish(r === undefined ? v : r);
      } catch (err) {
        $('.form-error', form).textContent = err.message || String(err);
        btn.disabled = false;
      }
    });
    d.showModal();
    const auto = $('[autofocus]', form);
    if (auto && matchMedia('(pointer: fine)').matches) auto.focus();
  });
}

// ------------------------------------------------------------------ tooltip

let tipEl = null;
export function initTooltips() {
  tipEl = document.createElement('div');
  tipEl.className = 'tooltip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  const show = (target, x, y) => {
    const lines = target.dataset.tip.split('\n');
    tipEl.replaceChildren(...lines.map((l, i) => {
      const div = document.createElement('div');
      div.className = i === 0 ? 'tip-title' : 'tip-row';
      div.textContent = l;
      return div;
    }));
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
    document.querySelectorAll('.tip-active').forEach((el) => el.classList.remove('tip-active'));
    target.classList.add('tip-active');
  };
  const hide = () => {
    tipEl.hidden = true;
    document.querySelectorAll('.tip-active').forEach((el) => el.classList.remove('tip-active'));
  };
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) show(t, e.clientX, e.clientY);
    else if (!tipEl.hidden && e.pointerType === 'mouse') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) show(t, e.clientX, e.clientY);
    else hide();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) {
      const r = t.getBoundingClientRect();
      show(t, r.left + r.width / 2, r.top);
    }
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}

/** Triggers a browser download of text content. */
export function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
