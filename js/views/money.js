// Money tab: expenses, income, savings.

import * as C from '../calc.js';
import * as D from '../dates.js';
import { html } from '../ui.js';
import { ctx, ui } from '../context.js';
import { describeSource } from '../forms.js';
import { ico, tag, status, stat, meter, pageHead, tabs, monthNav, empty } from './common.js';

const SECTIONS = [{ key: 'expenses', label: 'Expenses' }, { key: 'income', label: 'Income' }, { key: 'savings', label: 'Savings' }];

function groupByDate(items, dateKey = 'date') {
  const groups = new Map();
  for (const it of [...items].sort((a, b) => (b[dateKey] > a[dateKey] ? 1 : b[dateKey] < a[dateKey] ? -1 : (b.createdAt || 0) - (a.createdAt || 0)))) {
    if (!groups.has(it[dateKey])) groups.set(it[dateKey], []);
    groups.get(it[dateKey]).push(it);
  }
  return [...groups.entries()];
}

function expenses() {
  const { state, today, fmt } = ctx;
  const month = ui.expenseMonth || D.startOfMonth(today);
  const from = D.startOfMonth(month);
  const to = D.endOfMonth(month);
  const isCurrent = from === D.startOfMonth(today);
  let items = state.expenses.filter((e) => e.date >= from && e.date <= to);
  const monthTotal = items.reduce((t, e) => t + e.amount, 0);
  if (ui.expenseFilter) items = items.filter((e) => e.category === ui.expenseFilter);
  const t = C.spendingTotals(state, today);
  const daysIn = isCurrent ? D.parts(today).d : D.parts(to).d;
  return html`
    ${monthNav('expense-month', month, today)}
    <div class="stats ${isCurrent ? 'stats-4' : 'stats-2'} card">
      ${isCurrent ? html`${stat('Today', fmt(t.today))}${stat('This week', fmt(t.week))}` : ''}
      ${stat(isCurrent ? 'This month' : 'Month total', fmt(monthTotal))}
      ${stat('Daily average', fmt(Math.round(monthTotal / daysIn)))}
    </div>
    <div class="toolbar">
      <label class="sr-only" for="expense-filter">Category</label>
      <select id="expense-filter" data-change="expense-filter">
        <option value="">All categories</option>
        ${C.EXPENSE_CATEGORIES.map((c) => html`<option value="${c.key}"${ui.expenseFilter === c.key ? ' selected' : ''}>${c.label}</option>`)}
      </select>
      <button class="btn btn-primary" data-action="add-expense">${ico('plus')} Add expense</button>
    </div>
    ${items.length ? groupByDate(items).map(([date, list]) => html`
      <section class="day-group">
        <div class="day-head"><span>${D.fmtDay(date)}${date === today ? ' · Today' : ''}</span><span>${fmt(list.reduce((t, e) => t + e.amount, 0))}</span></div>
        <ul class="rows card">${list.map((e) => html`
          <li class="row tappable" data-action="edit-expense" data-id="${e.id}" tabindex="0" role="button">
            <span class="cat-dot cat-${e.category}"></span>
            <div class="row-main"><strong>${e.note || C.expenseLabel(e.category)}</strong><small>${C.expenseLabel(e.category)}${e.purchaseId ? ' · planned purchase' : ''}</small></div>
            <span class="amount">${fmt(e.amount)}</span>
          </li>`)}</ul>
      </section>`) : empty(ui.expenseFilter ? 'No expenses in this category' : 'No expenses this month', 'Record what you spend to see where your money goes.', html`<button class="btn btn-primary" data-action="add-expense">Add expense</button>`)}`;
}

function income() {
  const { state, today, fmt } = ctx;
  const month = ui.incomeMonth || D.startOfMonth(today);
  const from = D.startOfMonth(month);
  const to = D.endOfMonth(month);
  const tracked = state.settings.openingDate || '0000-01-01';
  const occ = C.expectedIncome(state, from, to);
  const received = state.income.filter((r) => r.date >= from && r.date <= to);
  const receivedTotal = received.reduce((t, r) => t + r.amount, 0);
  const pending = occ.filter((o) => !o.received && o.date >= tracked);
  const pendingTotal = pending.reduce((t, o) => t + o.amount, 0);
  return html`
    ${monthNav('income-month', month, today)}
    <div class="stats stats-3 card">
      ${stat('Received', fmt(receivedTotal), '', tag('actual'))}
      ${stat('Still expected', fmt(pendingTotal), '', tag('expected'))}
      ${stat('Total', fmt(receivedTotal + pendingTotal))}
    </div>
    <section class="card">
      <div class="card-head"><h2>Scheduled this month</h2></div>
      ${occ.length ? html`<ul class="rows">${occ.map((o) => {
        const before = o.date < tracked;
        return html`<li class="row">
          <div class="row-main"><strong>${o.source.name}</strong><small>${D.fmtDay(o.date)} · ${C.INCOME_KINDS.find((k) => k.key === o.source.kind)?.label}</small></div>
          ${o.received
            ? html`<div class="row-side"><span class="amount">${fmt(o.received.amount)}</span>${status('paid', 'Received')}</div>`
            : before
              ? html`<div class="row-side"><span class="amount muted">${fmt(o.amount)}</span><small class="muted">Before tracking started</small></div>`
              : html`<div class="row-side"><span class="amount">${fmt(o.amount)}${tag('expected')}</span>${o.date <= today ? status('today', o.date === today ? 'Due today' : 'Not recorded') : status('upcoming', D.relDays(o.date, today))}</div>
                 <button class="btn btn-small" data-action="receive-income" data-key="${o.key}">Received</button>`}
        </li>`;
      })}</ul>` : html`<p class="muted">Nothing scheduled this month.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>Received this month</h2><button class="btn btn-small" data-action="add-income">${ico('plus')} Record income</button></div>
      ${received.length ? html`<ul class="rows">${[...received].sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => html`
        <li class="row tappable" data-action="edit-income" data-id="${r.id}" tabindex="0" role="button">
          <div class="row-main"><strong>${r.name || C.INCOME_KINDS.find((k) => k.key === r.kind)?.label}</strong><small>${D.fmtDay(r.date)}${r.dueDate && r.dueDate !== r.date ? ` · for ${D.fmtShort(r.dueDate)}` : ''}</small></div>
          <span class="amount pos">+${fmt(r.amount)}</span>
        </li>`)}</ul>` : html`<p class="muted">No income recorded this month.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>Income schedule</h2><button class="btn btn-small" data-action="add-income-source">${ico('plus')} Add</button></div>
      ${state.incomeSources.length ? html`<ul class="rows">${state.incomeSources.map((s) => html`
        <li class="row tappable" data-action="edit-income-source" data-id="${s.id}" tabindex="0" role="button">
          <div class="row-main"><strong>${s.name}${s.active === false ? ' (paused)' : ''}</strong><small>${describeSource(s)}</small></div>
          <span class="amount">${fmt(s.amount)}</span>
        </li>`)}</ul>` : html`<p class="muted">Add your salary (for example, paid on the 5th and 20th) and any allowances so the app knows what to expect.</p>`}
    </section>`;
}

function savings() {
  const { state, today, fmt } = ctx;
  const s = state.settings;
  const bal = C.savingsBalance(state, today);
  const s2s = C.safeToSpend(state, today);
  const pct = s.goalTarget ? bal / s.goalTarget : null;
  const entries = [...state.savings].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return html`
    <section class="card">
      <div class="card-head"><h2>Savings balance</h2>${tag('actual')}</div>
      <div class="big-number">${fmt(bal)}</div>
      ${pct != null ? html`
        <div class="goal-line"><span>${s.goalName || 'Goal'} · ${fmt(s.goalTarget)}${s.goalDate ? ` by ${D.fmtLong(s.goalDate)}` : ''}</span><strong>${Math.min(999, Math.round(pct * 100))}%</strong></div>
        ${meter(pct, pct >= 1 ? 'good' : 'accent')}
        ${bal < s.goalTarget ? html`<p class="small muted">${fmt(s.goalTarget - bal)} to go${s.goalDate && s.goalDate > today ? (() => {
          const months = Math.max(1, Math.round(D.diffDays(today, s.goalDate) / 30.44));
          return ` · about ${fmt(Math.ceil((s.goalTarget - bal) / months))} a month to reach it on time`;
        })() : ''}.</p>` : html`<p class="small">Goal reached.</p>`}` : ''}
      <div class="btn-row">
        <button class="btn btn-primary" data-action="add-savings">${ico('plus')} Set aside</button>
        <button class="btn" data-action="withdraw-savings">Withdraw</button>
        <button class="btn btn-ghost" data-action="savings-plan">Plan and goal</button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Savings plan</h2>${tag('planned')}</div>
      ${s.savingsPerPayday ? html`
        <p>Set aside <strong>${fmt(s.savingsPerPayday)}</strong> every payday (${C.getPaydays(state).map(D.ordinal).join(' & ')}).</p>
        <p class="small">This pay period (since ${D.fmtShort(s2s.periodStart)}): ${fmt(s2s.savedThisPeriod)} set aside${s2s.savingsReserve ? `, ${fmt(s2s.savingsReserve)} still reserved from your spending money` : ' · done'}.</p>`
        : html`<p class="muted">No savings plan yet. See Insights for a recommended amount based on your records.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>History</h2></div>
      ${entries.length ? html`<ul class="rows">${entries.map((e) => html`
        <li class="row tappable" data-action="edit-savings" data-id="${e.id}" tabindex="0" role="button">
          <div class="row-main"><strong>${e.note || (e.amount < 0 ? 'Withdrawal' : 'Set aside')}</strong><small>${D.fmtDay(e.date)}</small></div>
          <span class="amount ${e.amount < 0 ? 'neg' : 'pos'}">${e.amount < 0 ? '−' : '+'}${fmt(Math.abs(e.amount))}</span>
        </li>`)}</ul>` : html`<p class="muted">No savings entries yet.</p>`}
    </section>`;
}

export function render(route) {
  const sub = SECTIONS.some((s) => s.key === route.sub) ? route.sub : 'expenses';
  return html`
    ${pageHead('Money')}
    ${tabs('money', sub, SECTIONS)}
    ${sub === 'income' ? income() : sub === 'savings' ? savings() : expenses()}`;
}
