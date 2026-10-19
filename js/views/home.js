// Dashboard.

import * as C from '../calc.js';
import * as D from '../dates.js';
import { html } from '../ui.js';
import { ctx, chart } from '../context.js';
import { lineChart, columnChart, legend, hbars, tableView } from '../charts.js';
import * as notify from '../notify.js';
import { ico, tag, status, stat, meter } from './common.js';

function gettingStarted(state) {
  const sup = notify.support();
  const steps = [
    { done: !!state.settings.openingDate, label: 'Set your starting balance', action: 'opening-balance' },
    { done: state.incomeSources.some((s) => s.kind === 'salary'), label: 'Add your salary schedule', action: 'add-income-source' },
    { done: state.bills.length > 0, label: 'Add your bills', action: 'add-bill' },
    { done: state.expenses.length > 0, label: 'Record an expense', action: 'add-expense' },
  ];
  if (steps.every((s) => s.done)) return '';
  return html`<section class="card getting-started">
    <h2>Get started</h2>
    <ol class="steps">${steps.map((s) => html`<li class="${s.done ? 'done' : ''}">
      ${s.done ? ico('check') : html`<span class="step-dot"></span>`}
      ${s.done ? html`<span>${s.label}</span>` : html`<button class="link" data-action="${s.action}">${s.label}</button>`}
    </li>`)}</ol>
    ${sup.permission === 'default' && sup.notifications ? html`<p class="muted small">Tip: turn on bill reminders in Settings.</p>` : ''}
  </section>`;
}

function alertsBlock(list) {
  if (!list.length) return '';
  const one = (a) => html`
    <a class="alert alert-${a.level}" href="${a.href}">
      ${ico(a.level === 'info' ? 'info' : a.level)}
      <span><strong>${a.title}</strong><small>${a.detail}</small></span>
    </a>`;
  const shown = list.slice(0, 3);
  const rest = list.slice(3);
  return html`<section class="alerts" aria-label="Warnings">${shown.map(one)}
    ${rest.length ? html`<details class="more-alerts"><summary>${rest.length} more notice${rest.length > 1 ? 's' : ''}</summary><div class="alerts">${rest.map(one)}</div></details>` : ''}
  </section>`;
}

function hero(s, fmt) {
  const short = s.available < 0;
  const segs = [
    { key: 'bills', label: 'Bills due before payday', value: s.billsTotal, cls: 's2' },
    { key: 'savings', label: 'Savings still to set aside', value: s.savingsReserve, cls: 's3' },
    { key: 'purchases', label: 'Purchases planned before payday', value: s.purchasesTotal, cls: 's4' },
    { key: 'safe', label: 'Safe to spend', value: Math.max(0, s.available), cls: 's1' },
  ];
  const total = Math.max(1, segs.reduce((t, x) => t + x.value, 0));
  return html`<section class="card hero${short ? ' hero-short' : ''}">
    <div class="hero-top">
      <span class="eyebrow">${short ? 'Shortfall before payday' : `Safe to spend until ${D.fmtDay(s.nextPayday)}`}</span>
      ${tag('actual')}
    </div>
    <div class="hero-figure">${short ? fmt(-s.available) : fmt(s.available)}</div>
    <p class="hero-sub">${short
      ? 'Your bills, savings plan and planned purchases before payday are more than the cash you have.'
      : html`<strong>${fmt(s.perDay)}</strong> per day · ${s.daysLeft} day${s.daysLeft > 1 ? 's' : ''} until payday`}</p>
    <div class="alloc-bar" role="img" aria-label="How your cash on hand is allocated">${segs.filter((x) => x.value > 0).map((x) => html`<span class="${x.cls}" style="flex:${(x.value / total).toFixed(4)}" data-tip="${x.label}\n${fmt(x.value)}" tabindex="0"></span>`)}</div>
    <dl class="alloc-list">
      <div class="alloc-row total"><dt>Cash on hand</dt><dd>${fmt(s.cash)}</dd></div>
      ${segs.map((x) => html`<div class="alloc-row"><dt><span class="swatch ${x.cls}"></span>${x.label}</dt><dd>${x.key === 'safe' ? '' : '−'}${fmt(x.value)}</dd></div>`)}
    </dl>
    <p class="muted small">${s.essentialDaily != null
      ? html`Your essentials (food, transport, fuel, groceries, motorcycle, personal) usually cost <strong>${fmt(s.essentialDaily)}</strong> a day, based on the last ${s.statsDays} days.`
      : 'Record expenses for at least a week to see what your essentials usually cost per day.'}
      Expected income is not counted until you receive it.</p>
  </section>`;
}

function upcomingBills(state, today, fmt) {
  const list = C.billSchedule(state, D.addDays(today, 14), today).filter((o) => !o.payment);
  const monthUnpaid = C.unpaidBills(state, D.endOfMonth(today), today);
  const total = monthUnpaid.reduce((t, o) => t + o.amount, 0);
  return html`<section class="card">
    <div class="card-head"><h2>Upcoming bills</h2><a class="link" href="#/bills">All bills</a></div>
    ${list.length ? html`<ul class="rows">${list.slice(0, 6).map((o) => html`<li class="row">
      <div class="row-main"><strong>${o.bill.name}</strong><small>${D.fmtDay(o.due)} · ${D.relDays(o.due, today)}</small></div>
      <div class="row-side"><span class="amount">${fmt(o.amount)}${o.bill.estimate ? tag('estimate') : ''}</span>${status(o.status)}</div>
      <button class="btn btn-small" data-action="pay-bill" data-key="${o.key}">Pay</button>
    </li>`)}</ul>` : html`<p class="muted">${state.bills.length ? 'Nothing due in the next 14 days.' : 'No bills yet.'} ${state.bills.length ? '' : html`<button class="link" data-action="add-bill">Add a bill</button>`}</p>`}
    <div class="card-foot"><span>Unpaid through ${D.fmtShort(D.endOfMonth(today))}</span><strong>${fmt(total)}</strong></div>
  </section>`;
}

function allocation(state, today, fmt) {
  const m = C.monthAllocation(state, today);
  const row = (label, value, kind, sign = '') => html`<div class="ledger-row"><span>${label}</span><span class="amount">${sign}${fmt(value)}</span>${tag(kind)}</div>`;
  return html`<section class="card">
    <div class="card-head"><h2>${D.fmtMonth(today)} salary allocation</h2></div>
    <div class="ledger">
      ${row('Carried over from before', m.carryOver, 'actual')}
      ${row('Income received', m.incomeReceived, 'actual', '+')}
      ${row('Income still expected', m.incomeExpected, 'expected', '+')}
      ${row('Bills paid', m.billsPaid, 'actual', '−')}
      ${row(m.overdueFromBefore ? `Bills unpaid (incl. ${fmt(m.overdueFromBefore)} overdue from before)` : 'Bills unpaid', m.billsUnpaid, 'due', '−')}
      ${row('Expenses', m.expensesPaid, 'actual', '−')}
      ${row('Planned purchases', m.purchasesPlanned, 'planned', '−')}
      ${row('Savings set aside', m.savingsDone, 'actual', '−')}
      ${row('Savings still to set aside', m.savingsRemaining, 'planned', '−')}
      <div class="ledger-row ledger-total${m.remaining < 0 ? ' negative' : ''}"><span>Left after obligations</span><span class="amount">${fmt(m.remaining)}</span>${tag('forecast')}</div>
    </div>
    <p class="muted small">What would remain at month end after everything above, before any further day-to-day spending.</p>
  </section>`;
}

function forecastCard(state, today, fmt) {
  const f = C.forecast(state, today);
  const pts = f.points.map((p, i) => ({
    label: i === 0 ? 'Now' : D.fmtShort(p.date),
    value: p.balance,
    tip: [`${i === 0 ? 'Now (actual cash)' : `${D.fmtDay(p.date)} (forecast)`}: ${fmt(p.balance)}`, ...p.events.map((e) => `${e.amount < 0 ? '−' : '+'}${fmt(Math.abs(e.amount))} ${e.label}`)].join('\n'),
  }));
  const before = f.points.at(-1);
  return html`<section class="card">
    <div class="card-head"><h2>Forecast to payday</h2>${tag('forecast')}</div>
    ${legend([{ label: 'Actual cash now', cls: 's1' }, { label: 'Forecast balance', cls: 's1', line: true, dashed: true }])}
    ${chart((w) => lineChart({ width: w, points: pts, fmtAxis: ctx.fmtAxis, ariaLabel: 'Forecast balance until payday' }))}
    <div class="kv">
      <div><span>On payday (${D.fmtShort(f.nextPayday)}), before salary</span><strong class="${before.balance < 0 ? 'neg' : ''}">${fmt(before.balance)}</strong></div>
      ${f.lowest.balance < 0 ? html`<div><span>Lowest point</span><strong class="neg">${fmt(f.lowest.balance)} on ${D.fmtShort(f.lowest.date)}</strong></div>` : ''}
      ${f.paydayIncome ? html`<div><span>Salary expected on payday</span><strong>${fmt(f.paydayIncome)}</strong></div>` : ''}
    </div>
    <p class="muted small">${f.hasPace
      ? `Assumes you keep spending about ${fmt(f.dailySpend)} a day (your average over the last ${f.paceDays} days), plus scheduled bills, planned purchases and expected income.`
      : 'Not enough spending history yet, so this only includes scheduled bills, planned purchases and expected income.'}</p>
    ${tableView(['Date', 'Balance'], f.points.map((p, i) => [i === 0 ? 'Now (actual)' : D.fmtDay(p.date), fmt(p.balance)]))}
  </section>`;
}

function spendingCard(state, today, fmt) {
  const t = C.spendingTotals(state, today);
  const rows = C.categoryBreakdown(state, D.startOfMonth(today), today);
  const top = rows.slice(0, 7);
  const rest = rows.slice(7).reduce((s, r) => s + r.amount, 0);
  if (rest) top.push({ label: 'Everything else', amount: rest });
  return html`<section class="card">
    <div class="card-head"><h2>Spending</h2>${tag('actual')}</div>
    <div class="stats stats-3">
      ${stat('Today', fmt(t.today))}
      ${stat('This week', fmt(t.week))}
      ${stat('This month', fmt(t.month), `+ ${fmt(t.billsMonth)} bills paid`)}
    </div>
    <h3 class="sub-head">By category this month</h3>
    ${top.length ? html`${hbars(top.map((r) => ({ label: r.label, value: r.amount, display: fmt(r.amount) })))}` : html`<p class="muted">No spending recorded this month.</p>`}
  </section>`;
}

function incomeVsSpending(state, today, fmt) {
  const series = C.monthlySeries(state, today, 6);
  if (!series.some((m) => m.income || m.outflow)) return '';
  return html`<section class="card">
    <div class="card-head"><h2>Income vs spending</h2>${tag('actual')}</div>
    ${legend([{ label: 'Income received', cls: 's1' }, { label: 'Spent (expenses + bills)', cls: 's2' }])}
    ${chart((w) => columnChart({
      width: w,
      categories: series.map((m) => ({ label: D.fmtMonthShort(m.month), tip: `${D.fmtMonth(m.month)}\nIncome ${fmt(m.income)}\nSpent ${fmt(m.outflow)}\nNet ${fmt(m.net)}` })),
      series: [{ name: 'Income', cls: 's1', values: series.map((m) => m.income) }, { name: 'Spent', cls: 's2', values: series.map((m) => m.outflow) }],
      fmtAxis: ctx.fmtAxis,
      ariaLabel: 'Monthly income versus spending',
    }))}
    ${tableView(['Month', 'Income', 'Expenses', 'Bills', 'Net'], series.map((m) => [D.fmtMonth(m.month), fmt(m.income), fmt(m.expenses), fmt(m.bills), fmt(m.net)]))}
  </section>`;
}

function savingsCard(state, today, fmt, s2s) {
  const s = state.settings;
  const bal = C.savingsBalance(state, today);
  const pct = s.goalTarget ? bal / s.goalTarget : null;
  return html`<section class="card">
    <div class="card-head"><h2>Savings</h2><a class="link" href="#/money/savings">Details</a></div>
    <div class="big-number">${fmt(bal)} ${tag('actual')}</div>
    ${pct != null ? html`
      <div class="goal-line"><span>${s.goalName || 'Goal'}: ${fmt(s.goalTarget)}${s.goalDate ? ` by ${D.fmtLong(s.goalDate)}` : ''}</span><strong>${Math.min(999, Math.round(pct * 100))}%</strong></div>
      ${meter(pct, pct >= 1 ? 'good' : 'accent')}` : html`<p class="muted small"><button class="link" data-action="savings-plan">Set a savings goal</button></p>`}
    ${s.savingsPerPayday ? html`<p class="small">This pay period: set aside <strong>${fmt(s2s.savedThisPeriod)}</strong> of <strong>${fmt(s.savingsPerPayday)}</strong> planned.
      ${s2s.savingsReserve ? html`<button class="link" data-action="add-savings">Move ${fmt(s2s.savingsReserve)} to savings</button>` : ''}</p>` : ''}
  </section>`;
}

function purchasesCard(state, today, fmt) {
  const plan = C.purchasePlan(state, today);
  if (!plan.items.length) return '';
  return html`<section class="card">
    <div class="card-head"><h2>Purchase priorities</h2><a class="link" href="#/plan/purchases">Plan</a></div>
    <ul class="rows">${plan.items.slice(0, 4).map((i) => html`<li class="row">
      <div class="row-main"><strong>${i.order}. ${i.purchase.name}</strong><small>${C.priorityOf(i.purchase.priority).label}${i.purchase.targetDate ? ` · by ${D.fmtShort(i.purchase.targetDate)}` : ''}</small></div>
      <div class="row-side"><span class="amount">${fmt(i.purchase.price)}${tag('estimate')}</span>${status(i.verdict, i.verdict === 'buy' ? null : `${i.verdict === 'wait' ? 'Short' : 'Postpone'} · ${fmt(i.shortBy)}`)}</div>
    </li>`)}</ul>
  </section>`;
}

export function render() {
  const { state, today } = ctx;
  const fmt = ctx.fmt;
  const s2s = C.safeToSpend(state, today);
  const ns = C.nextSalary(state, today);
  const monthUnpaid = C.unpaidBills(state, D.endOfMonth(today), today);
  const overdue = monthUnpaid.filter((o) => o.status === 'overdue');
  return html`
    ${gettingStarted(state)}
    ${alertsBlock(C.alerts(state, today, fmt))}
    <div class="grid">
      <div class="col">
        ${hero(s2s, fmt)}
        <div class="stats stats-2 card">
          ${stat('Next salary', D.fmtDay(ns.date), ns.amount ? html`${fmt(ns.amount)} ${tag('expected')}` : html`<button class="link" data-action="add-income-source">Add salary</button>`)}
          ${stat('Unpaid bills', fmt(monthUnpaid.reduce((t, o) => t + o.amount, 0)), `${monthUnpaid.length} this month${overdue.length ? ` · ${overdue.length} overdue` : ''}`)}
        </div>
        ${upcomingBills(state, today, fmt)}
        ${forecastCard(state, today, fmt)}
        ${purchasesCard(state, today, fmt)}
      </div>
      <div class="col">
        ${allocation(state, today, fmt)}
        ${spendingCard(state, today, fmt)}
        ${incomeVsSpending(state, today, fmt)}
        ${savingsCard(state, today, fmt, s2s)}
      </div>
    </div>`;
}
