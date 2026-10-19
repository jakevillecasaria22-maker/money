// Bills tab: upcoming and overdue payments, bill list, payment history.

import * as C from '../calc.js';
import * as D from '../dates.js';
import { html } from '../ui.js';
import { ctx, ui } from '../context.js';
import { ico, tag, status, stat, pageHead, tabs, monthNav, empty } from './common.js';

const SECTIONS = [{ key: 'upcoming', label: 'Upcoming' }, { key: 'all', label: 'All bills' }, { key: 'history', label: 'Paid' }];
const sum = (list) => list.reduce((t, o) => t + o.amount, 0);

function occurrenceRow(o, today, fmt) {
  return html`<li class="row">
    <span class="cat-dot bill-${o.bill.category}"></span>
    <div class="row-main"><strong>${o.bill.name}</strong><small>${C.billLabel(o.bill.category)} · ${D.fmtDay(o.due)} · ${D.relDays(o.due, today)}</small></div>
    <div class="row-side"><span class="amount">${fmt(o.amount)}${o.bill.estimate ? tag('estimate') : ''}</span>${status(o.status)}</div>
    <button class="btn btn-small${o.status === 'overdue' || o.status === 'today' ? ' btn-primary' : ''}" data-action="pay-bill" data-key="${o.key}">Pay</button>
  </li>`;
}

function upcoming() {
  const { state, today, fmt } = ctx;
  const horizon = D.addDays(today, 45);
  const sched = C.billSchedule(state, horizon, today, D.addDays(D.startOfMonth(today), 0));
  const unpaidAll = C.unpaidBills(state, horizon, today);
  const overdue = unpaidAll.filter((o) => o.status === 'overdue');
  const dueToday = unpaidAll.filter((o) => o.status === 'today');
  const week = unpaidAll.filter((o) => o.due > today && o.due <= D.addDays(today, 7));
  const later = unpaidAll.filter((o) => o.due > D.addDays(today, 7));
  const monthEnd = D.endOfMonth(today);
  const unpaidMonth = C.unpaidBills(state, monthEnd, today);
  const paidMonth = sched.filter((o) => o.payment && o.due >= D.startOfMonth(today) && o.due <= monthEnd);
  const group = (title, list, cls = '') => (list.length ? html`<section class="bill-group ${cls}">
    <div class="day-head"><span>${title}</span><span>${fmt(sum(list))}</span></div>
    <ul class="rows card">${list.map((o) => occurrenceRow(o, today, fmt))}</ul></section>` : '');
  if (!state.bills.length) {
    return empty('No bills yet', 'Add electricity, water, internet, phone, rent, loans, credit cards, subscriptions or any other obligation. You will get reminders before they are due.', html`<button class="btn btn-primary" data-action="add-bill">Add a bill</button>`);
  }
  return html`
    <div class="stats stats-3 card">
      ${stat('Overdue', fmt(sum(overdue)), `${overdue.length} bill${overdue.length === 1 ? '' : 's'}`)}
      ${stat(`Unpaid to ${D.fmtShort(monthEnd)}`, fmt(sum(unpaidMonth)), `${unpaidMonth.length} bill${unpaidMonth.length === 1 ? '' : 's'}`)}
      ${stat('Paid this month', fmt(paidMonth.reduce((t, o) => t + o.payment.amount, 0)), `${paidMonth.length} bill${paidMonth.length === 1 ? '' : 's'}`)}
    </div>
    ${group('Overdue', overdue, 'group-critical')}
    ${group('Due today', dueToday, 'group-warning')}
    ${group('Next 7 days', week)}
    ${group('Later (next 45 days)', later)}
    ${!unpaidAll.length ? html`<p class="muted center">All caught up. Nothing due in the next 45 days.</p>` : ''}
    ${paidMonth.length ? html`<section class="bill-group">
      <div class="day-head"><span>Paid this month</span><span>${fmt(paidMonth.reduce((t, o) => t + o.payment.amount, 0))}</span></div>
      <ul class="rows card">${paidMonth.map((o) => html`<li class="row tappable" data-action="edit-payment" data-id="${o.payment.id}" tabindex="0" role="button">
        <div class="row-main"><strong>${o.bill.name}</strong><small>Due ${D.fmtShort(o.due)} · paid ${D.fmtShort(o.payment.paidDate)}</small></div>
        <div class="row-side"><span class="amount">${fmt(o.payment.amount)}</span>${status('paid')}</div>
      </li>`)}</ul></section>` : ''}
    <div class="center"><button class="btn" data-action="add-bill">${ico('plus')} Add bill</button></div>`;
}

function allBills() {
  const { state, today, fmt } = ctx;
  if (!state.bills.length) return empty('No bills yet', 'Add your recurring and one-time obligations.', html`<button class="btn btn-primary" data-action="add-bill">Add a bill</button>`);
  const rows = state.bills.map((b) => {
    const next = C.unpaidBills({ ...state, bills: [b] }, D.addDays(today, 800), today)[0];
    const ended = b.endDate && b.endDate < today && !next;
    return { b, next, ended };
  }).sort((x, y) => (x.next?.due || '9999') .localeCompare(y.next?.due || '9999') || x.b.name.localeCompare(y.b.name));
  const monthly = state.bills.reduce((t, b) => t + C.monthlyEquivalent(b, today), 0);
  return html`
    <div class="card stats stats-2">
      ${stat('Bills', String(state.bills.length), `${state.bills.filter((b) => b.active === false).length} paused`)}
      ${stat('Monthly equivalent', fmt(monthly), 'all active recurring bills')}
    </div>
    <ul class="rows card">${rows.map(({ b, next, ended }) => html`
      <li class="row tappable" data-action="edit-bill" data-id="${b.id}" tabindex="0" role="button">
        <span class="cat-dot bill-${b.category}"></span>
        <div class="row-main"><strong>${b.name}</strong><small>${C.billLabel(b.category)} · ${C.describeRecurrence(b)}${b.endDate ? ` · until ${D.fmtLong(b.endDate)}` : ''}</small>
          <small>${b.active === false ? 'Paused' : ended ? 'Ended' : next ? `Next due ${D.fmtDay(next.due)}` : 'No upcoming due date'}</small></div>
        <div class="row-side"><span class="amount">${fmt(b.amount)}${b.estimate ? tag('estimate') : ''}</span>${next && b.active !== false ? status(next.status) : ''}</div>
      </li>`)}</ul>
    <div class="center"><button class="btn btn-primary" data-action="add-bill">${ico('plus')} Add bill</button></div>`;
}

function history() {
  const { state, today, fmt } = ctx;
  const month = ui.historyMonth || D.startOfMonth(today);
  const from = D.startOfMonth(month);
  const to = D.endOfMonth(month);
  const list = state.billPayments.filter((p) => p.paidDate >= from && p.paidDate <= to).sort((a, b) => (a.paidDate < b.paidDate ? 1 : -1));
  return html`
    ${monthNav('history-month', month, today)}
    <div class="card stats stats-2">${stat('Paid', fmt(sum(list)), '', tag('actual'))}${stat('Payments', String(list.length))}</div>
    ${list.length ? html`<ul class="rows card">${list.map((p) => html`
      <li class="row tappable" data-action="edit-payment" data-id="${p.id}" tabindex="0" role="button">
        <span class="cat-dot bill-${p.category}"></span>
        <div class="row-main"><strong>${p.billName}</strong><small>Paid ${D.fmtDay(p.paidDate)} · due ${D.fmtShort(p.dueDate)}${p.note ? ` · ${p.note}` : ''}</small></div>
        <span class="amount">${fmt(p.amount)}</span>
      </li>`)}</ul>` : html`<p class="muted center">No bill payments recorded in ${D.fmtMonth(month)}.</p>`}`;
}

export function render(route) {
  const sub = SECTIONS.some((s) => s.key === route.sub) ? route.sub : 'upcoming';
  return html`
    ${pageHead('Bills')}
    ${tabs('bills', sub, SECTIONS)}
    ${sub === 'all' ? allBills() : sub === 'history' ? history() : upcoming()}`;
}
