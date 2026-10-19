// Shared view pieces.

import { html, raw } from '../ui.js';
import { icon } from '../icons.js';
import { fmtMonth, addMonths, startOfMonth } from '../dates.js';

export const ico = (name, cls) => raw(icon(name, cls));

/** Labels that keep actual money apart from estimates and forecasts. */
const TAGS = {
  actual: ['Actual', 'Recorded transactions'],
  expected: ['Expected', 'Scheduled, not yet received or paid'],
  forecast: ['Forecast', 'Projection based on your schedule and average spending'],
  planned: ['Planned', 'Your plan, not yet spent'],
  estimate: ['Est.', 'Estimated amount'],
  due: ['Due', 'Owed, not yet paid'],
};
export const tag = (kind) => html`<span class="tag tag-${kind}" title="${TAGS[kind][1]}">${TAGS[kind][0]}</span>`;

const STATUS = {
  overdue: ['critical', 'Overdue'],
  today: ['warning', 'Due today'],
  soon: ['serious', 'Due soon'],
  upcoming: ['neutral', 'Upcoming'],
  paid: ['good', 'Paid'],
  over: ['critical', 'Over budget'],
  near: ['warning', 'Approaching'],
  ok: ['good', 'On track'],
  buy: ['good', 'Affordable now'],
  wait: ['warning', 'Not enough yet'],
  postpone: ['serious', 'Postpone'],
};
const STATUS_ICON = { critical: 'critical', warning: 'warning', serious: 'warning', good: 'good', neutral: 'calendar' };
export function status(kind, text) {
  const [level, label] = STATUS[kind] || ['neutral', kind];
  return html`<span class="status status-${level}">${ico(STATUS_ICON[level])}${text || label}</span>`;
}

export function pageHead(title, actions = '') {
  return html`<header class="page-head"><h1>${title}</h1><div class="page-actions">${actions}</div></header>`;
}

export function tabs(base, current, items) {
  return html`<nav class="seg" aria-label="Sections">${items.map((i) => html`<a href="#/${base}/${i.key}" class="seg-item${i.key === current ? ' active' : ''}"${i.key === current ? raw(' aria-current="page"') : ''}>${i.label}</a>`)}</nav>`;
}

export function monthNav(action, month, today) {
  const isCurrent = startOfMonth(month) === startOfMonth(today);
  return html`<div class="month-nav">
    <button class="icon-btn" data-action="${action}" data-delta="-1" aria-label="Previous month">${ico('left')}</button>
    <strong>${fmtMonth(month)}</strong>
    <button class="icon-btn" data-action="${action}" data-delta="1" aria-label="Next month"${isCurrent ? raw(' disabled') : ''}>${ico('right')}</button>
  </div>`;
}

export const shiftMonth = (month, delta) => addMonths(startOfMonth(month), delta);

export function empty(title, text, button = '') {
  return html`<div class="empty"><strong>${title}</strong><p>${text}</p>${button}</div>`;
}

export function stat(label, value, sub = '', extra = '') {
  return html`<div class="stat"><div class="stat-label">${label}${extra}</div><div class="stat-value">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

export function meter(pct, level = 'accent') {
  const p = Math.max(0, Math.min(100, pct * 100));
  return html`<div class="meter meter-${level}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}"><span style="width:${p.toFixed(1)}%"></span></div>`;
}
