// Insights: savings and spending recommendations from recorded data, plus reports.

import * as C from '../calc.js';
import * as D from '../dates.js';
import { html } from '../ui.js';
import { ctx, ui, chart } from '../context.js';
import { columnChart, legend, hbars, tableView } from '../charts.js';
import { ico, tag, status, stat, pageHead } from './common.js';

const R = C.RECOMMENDATION_RULES;

function savingsRecommendation(ins, fmt) {
  const s = ins.savings;
  if (s.noIncome) {
    return html`<section class="card"><div class="card-head"><h2>Recommended savings</h2></div>
      <p class="muted">Add your salary schedule or record income received so the app can work out what you can save.</p>
      <button class="btn" data-action="add-income-source">Add salary</button></section>`;
  }
  const planDiff = s.plannedSavingsMonthly - s.recommendedSavings;
  return html`<section class="card highlight">
    <div class="card-head"><h2>Recommended savings</h2><span class="muted small">per month</span></div>
    <div class="big-number">${fmt(s.recommendedSavings)}</div>
    ${s.recommendedSavings > 0
      ? html`<p class="small">That is about <strong>${fmt(Math.floor(s.recommendedSavings / s.paydaysPerMonth / 100) * 100)}</strong> each payday.</p>`
      : html`<p class="small warn-text">${ico('warning')} Your bills and spending use up your income. Cut the categories below before setting a savings amount.</p>`}
    <div class="ledger compact">
      <div class="ledger-row"><span>Income per month (${s.incomeBasis === 'scheduled' ? 'from your schedule' : 'from recorded income'})</span><span class="amount">${fmt(s.incomeMonthly)}</span>${tag(s.incomeBasis === 'scheduled' ? 'expected' : 'actual')}</div>
      <div class="ledger-row"><span>Bills per month</span><span class="amount">−${fmt(s.billsMonthly)}</span>${tag('due')}</div>
      <div class="ledger-row"><span>Spending at your current pace</span><span class="amount">−${fmt(s.spendingNow)}</span>${tag('actual')}</div>
      <div class="ledger-row ledger-total"><span>Left each month now</span><span class="amount ${s.surplusNow < 0 ? 'neg' : ''}">${fmt(s.surplusNow)}</span>${tag('forecast')}</div>
      <div class="ledger-row"><span>Spending with the recommended budget</span><span class="amount">−${fmt(s.spendingRecommended)}</span>${tag('planned')}</div>
      <div class="ledger-row ledger-total"><span>Left each month with the recommended budget</span><span class="amount ${s.surplusRecommended < 0 ? 'neg' : ''}">${fmt(s.surplusRecommended)}</span>${tag('forecast')}</div>
    </div>
    <p class="muted small">Following the recommended budget frees about <strong>${fmt(Math.max(0, s.spendingNow - s.spendingRecommended))}</strong> a month. The recommendation keeps ${Math.round(R.cushion * 100)}% of what is left as a cushion and rounds down.</p>
    ${s.plannedSavingsMonthly ? html`<p class="small">${planDiff > 0
      ? html`${ico('warning')} Your plan (${fmt(s.plannedSavingsMonthly)}/month) is ${fmt(planDiff)} more than your records support.`
      : planDiff < 0 ? html`Your plan sets aside ${fmt(s.plannedSavingsMonthly)}/month. You could raise it by up to ${fmt(-planDiff)}.` : 'Your savings plan matches the recommendation.'}</p>`
      : html`<button class="btn btn-small" data-action="savings-plan">Set a savings plan</button>`}
  </section>`;
}

function budgetTable(ins, fmt) {
  const rows = ins.categories;
  if (!rows.length) return '';
  return html`<section class="card">
    <div class="card-head"><h2>Recommended budget</h2><button class="btn btn-small" data-action="apply-recommended-budget">Use as my budgets</button></div>
    <p class="muted small">Per month, from the last ${ins.daysRecorded} days. Essentials stay at your typical level (unusual one-off expenses removed); Shopping and Other are trimmed by ${Math.round(R.flexibleCut * 100)}%. A lower budget you already set is kept.</p>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Category</th><th class="num">Now</th><th class="num">Recommended</th><th class="num">Save</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td>${r.label}${r.essential ? '' : html` <span class="prio prio-optional">Flexible</span>`}</td>
        <td class="num">${fmt(r.current)}</td><td class="num">${fmt(r.recommended)}</td>
        <td class="num ${r.cut ? 'pos' : 'muted'}">${r.cut ? fmt(r.cut) : '—'}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${fmt(rows.reduce((t, r) => t + r.current, 0))}</td><td class="num">${fmt(rows.reduce((t, r) => t + r.recommended, 0))}</td><td class="num">${fmt(rows.reduce((t, r) => t + r.cut, 0))}</td></tr></tfoot>
    </table></div>
  </section>`;
}

function whereToCut(ins, fmt) {
  const flexible = (ins.categories || []).filter((r) => !r.essential && r.current > 0);
  const items = [];
  for (const r of flexible) items.push(html`<li><strong>${r.label}</strong>: ${fmt(r.current)} a month. Cutting ${Math.round(R.flexibleCut * 100)}% saves ${fmt(r.cut)}.</li>`);
  if (ins.subscriptions.length) items.push(html`<li><strong>Subscriptions</strong>: ${fmt(ins.subscriptionsMonthly)} a month (${ins.subscriptions.map((s) => s.bill.name).join(', ')}). Cancel any you rarely use.</li>`);
  if (ins.optionalPurchases.length) items.push(html`<li><strong>Optional purchases</strong>: ${fmt(ins.optionalTotal)} planned (${ins.optionalPurchases.map((p) => p.name).join(', ')}). Postponing them keeps this money.</li>`);
  for (const r of ins.rising || []) items.push(html`<li><strong>${r.label}</strong> is rising: about ${fmt(r.nowMonthly)} a month so far this month vs ${fmt(r.priorMonthly)} before.</li>`);
  for (const r of ins.budget.rows.filter((x) => x.status === 'over')) items.push(html`<li><strong>${r.label}</strong> is over budget: ${fmt(r.spent)} of ${fmt(r.budget)}.</li>`);
  if (!items.length) return '';
  return html`<section class="card"><div class="card-head"><h2>Where you can cut</h2></div><ul class="bullets">${items}</ul></section>`;
}

function unusual(ins, fmt) {
  if (!ins.unusual?.length) return '';
  return html`<section class="card"><div class="card-head"><h2>Unusually high expenses</h2></div>
    <p class="muted small">At least ${R.unusualFactor}× what you usually spend per entry in that category.</p>
    <ul class="rows">${ins.unusual.map((u) => html`<li class="row tappable" data-action="edit-expense" data-id="${u.expense.id}" tabindex="0" role="button">
      <div class="row-main"><strong>${u.expense.note || C.expenseLabel(u.category)}</strong><small>${C.expenseLabel(u.category)} · ${D.fmtLong(u.expense.date)} · usual ${fmt(u.median)}</small></div>
      <span class="amount">${fmt(u.expense.amount)}</span></li>`)}</ul></section>`;
}

function budgetVsActual(ins, fmt) {
  const rows = ins.budget.rows.filter((r) => r.budget > 0);
  if (!rows.length) return '';
  return html`<section class="card"><div class="card-head"><h2>Budget vs actual · ${D.fmtMonth(ctx.today)}</h2><a class="link" href="#/plan/budget">Budget</a></div>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Projected</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${r.label}</td><td class="num">${fmt(r.budget)}</td><td class="num">${fmt(r.spent)}</td><td class="num">${fmt(r.projected)}</td><td>${status(r.status)}</td></tr>`)}</tbody>
    </table></div></section>`;
}

function reports() {
  const { state, today, fmt } = ctx;
  const unit = ui.spendUnit;
  const series = C.spendingSeries(state, today, unit);
  const label = (b) => (unit === 'day' ? D.fmtShort(b.from) : unit === 'week' ? D.fmtShort(b.from) : D.fmtMonthShort(b.from));
  const ranges = {
    month: { label: 'This month', from: D.startOfMonth(today), to: today },
    last: { label: 'Last month', from: D.addMonths(D.startOfMonth(today), -1), to: D.addDays(D.startOfMonth(today), -1) },
    d90: { label: 'Last 90 days', from: D.addDays(today, -89), to: today },
  };
  const range = ranges[ui.breakdownRange] || ranges.month;
  const breakdown = C.categoryBreakdown(state, range.from, range.to);
  const total = breakdown.reduce((t, r) => t + r.amount, 0);
  const avg = series.reduce((t, b) => t + b.expenses + b.bills, 0) / series.length;
  return html`
    <section class="card">
      <div class="card-head"><h2>Spending over time</h2>${tag('actual')}</div>
      <div class="seg seg-small" role="group" aria-label="Period">${[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].map(([k, l]) => html`<button class="seg-item${unit === k ? ' active' : ''}" data-action="spend-unit" data-unit="${k}" aria-pressed="${unit === k}">${l}</button>`)}</div>
      ${legend([{ label: 'Expenses', cls: 's7' }, { label: 'Bills paid', cls: 's2' }])}
      ${chart((w) => columnChart({
        width: w,
        stacked: true,
        categories: series.map((b) => ({ label: label(b), tip: `${unit === 'week' ? `Week of ${D.fmtShort(b.from)}` : unit === 'month' ? D.fmtMonth(b.from) : D.fmtDay(b.from)}\nExpenses ${fmt(b.expenses)}\nBills ${fmt(b.bills)}\nTotal ${fmt(b.expenses + b.bills)}` })),
        series: [{ name: 'Expenses', cls: 's7', values: series.map((b) => b.expenses) }, { name: 'Bills', cls: 's2', values: series.map((b) => b.bills) }],
        fmtAxis: ctx.fmtAxis,
        ariaLabel: 'Spending over time',
      }))}
      <p class="muted small">Average per ${unit}: ${fmt(Math.round(avg))}</p>
      ${tableView([unit === 'month' ? 'Month' : unit === 'week' ? 'Week of' : 'Day', 'Expenses', 'Bills', 'Total'], series.map((b) => [unit === 'month' ? D.fmtMonth(b.from) : D.fmtDay(b.from), fmt(b.expenses), fmt(b.bills), fmt(b.expenses + b.bills)]))}
    </section>
    <section class="card">
      <div class="card-head"><h2>Spending by category</h2>${tag('actual')}</div>
      <div class="seg seg-small" role="group" aria-label="Range">${Object.entries(ranges).map(([k, r]) => html`<button class="seg-item${(ui.breakdownRange || 'month') === k ? ' active' : ''}" data-action="breakdown-range" data-range="${k}">${r.label}</button>`)}</div>
      ${breakdown.length ? html`${hbars(breakdown.map((r) => ({ label: r.label, value: r.amount, display: fmt(r.amount), tip: `${r.label}\n${fmt(r.amount)} · ${Math.round((r.amount / total) * 100)}% of spending` })))}
        <p class="small">Total ${fmt(total)}</p>
        ${tableView(['Category', 'Amount', 'Share'], breakdown.map((r) => [r.label, fmt(r.amount), `${Math.round((r.amount / total) * 100)}%`]))}`
        : html`<p class="muted">No spending recorded for ${range.label.toLowerCase()}.</p>`}
    </section>`;
}

export function render() {
  const { state, today } = ctx;
  const fmt = ctx.fmt;
  const ins = C.insights(state, today);
  return html`
    ${pageHead('Insights')}
    ${ins.enough ? '' : html`<section class="card notice">
      ${ico('info')}
      <div><strong>Recommendations need a little more data</strong>
      <p class="small">They use only what you record: no guesses. ${ins.daysRecorded ? `You have ${ins.daysRecorded} day${ins.daysRecorded > 1 ? 's' : ''} of expenses so far; ` : 'Start recording your daily expenses; '}recommendations start after ${R.minDays} days.</p></div>
    </section>`}
    <div class="grid">
      <div class="col">
        ${ins.enough ? savingsRecommendation(ins, fmt) : ''}
        ${whereToCut(ins, fmt)}
        ${ins.enough ? unusual(ins, fmt) : ''}
        ${ins.enough ? budgetTable(ins, fmt) : ''}
        ${budgetVsActual(ins, fmt)}
      </div>
      <div class="col">${reports()}</div>
    </div>`;
}
