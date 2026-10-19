// Shared view context: current state, today's date, money formatting, chart mounting.

import * as store from './store.js';
import { todayISO } from './dates.js';
import { formatMoney, formatCompact } from './money.js';
import { html } from './ui.js';

const charts = new Map();
let seq = 0;

/** View-only UI state (month being viewed, toggles). Not saved. */
export const ui = {
  expenseMonth: null,
  incomeMonth: null,
  historyMonth: null,
  spendUnit: 'day',
  breakdownRange: 'month',
  expenseFilter: '',
  lastCategory: 'food',
  affordResult: null,
};

export function currencySymbol(currency) {
  try {
    const part = new Intl.NumberFormat('en-PH', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency');
    return part?.value || currency;
  } catch {
    return currency;
  }
}

export const ctx = {
  get state() { return store.state; },
  get today() { return todayISO(); },
  get currency() { return store.state.settings.currency || 'PHP'; },
  get symbol() { return currencySymbol(this.currency); },
  fmt(c) { return formatMoney(c, ctx.currency); },
  fmtAxis(c) { return formatCompact(c, ctx.currency); },
  ui,
};

/** Placeholder for a chart; the renderer runs after insertion with the measured width. */
export function chart(render, cls = '') {
  const id = `c${++seq}`;
  charts.set(id, render);
  return html`<div class="chart ${cls}" data-chart="${id}"></div>`;
}

export function mountCharts(root) {
  for (const el of root.querySelectorAll('[data-chart]')) {
    const fn = charts.get(el.dataset.chart);
    if (fn) el.innerHTML = fn(Math.floor(el.clientWidth));
  }
}

export function resetCharts() {
  charts.clear();
}
