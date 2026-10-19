// Plan tab: purchase planner and monthly budgets.

import * as C from '../calc.js';
import * as D from '../dates.js';
import { html } from '../ui.js';
import { ctx, ui } from '../context.js';
import { ico, tag, status, stat, meter, pageHead, tabs, empty } from './common.js';

const SECTIONS = [{ key: 'purchases', label: 'Purchases' }, { key: 'budget', label: 'Budget' }];

function purchaseRow(item, fmt) {
  const p = item.purchase || item;
  const v = item.verdict;
  return html`<li class="row">
    <div class="row-main tappable" data-action="edit-purchase" data-id="${p.id}" tabindex="0" role="button">
      <strong>${item.order ? `${item.order}. ` : ''}${p.name}</strong>
      <small><span class="prio prio-${p.priority}">${C.priorityOf(p.priority).label}</span>${p.targetDate ? ` · target ${D.fmtShort(p.targetDate)}` : ''}${p.note ? ` · ${p.note}` : ''}</small>
    </div>
    <div class="row-side"><span class="amount">${fmt(p.price)}${tag('estimate')}</span>
      ${v ? status(v, v === 'buy' ? null : `${v === 'wait' ? 'Short' : 'Postpone'} · ${fmt(item.shortBy)}`) : ''}</div>
    <div class="row-actions">
      ${p.status === 'postponed'
        ? html`<button class="btn btn-small" data-action="resume-purchase" data-id="${p.id}">Resume</button>`
        : html`<button class="btn btn-small" data-action="bought-purchase" data-id="${p.id}">Bought</button>
               <button class="btn btn-small btn-ghost" data-action="postpone-purchase" data-id="${p.id}">Postpone</button>`}
    </div>
  </li>`;
}

function purchases() {
  const { state, today, fmt } = ctx;
  const plan = C.purchasePlan(state, today);
  const s = plan.summary;
  const buy = plan.items.filter((i) => i.verdict === 'buy');
  const wait = plan.items.filter((i) => i.verdict === 'wait');
  const postpone = plan.items.filter((i) => i.verdict === 'postpone');
  const bought = state.purchases.filter((p) => p.status === 'bought').sort((a, b) => ((a.boughtDate || '') < (b.boughtDate || '') ? 1 : -1)).slice(0, 10);
  const r = ui.affordResult;
  const list = (title, items, hint) => (items.length ? html`<section class="card">
    <div class="card-head"><h2>${title}</h2><span class="muted small">${fmt(items.reduce((t, i) => t + (i.purchase || i).price, 0))}</span></div>
    ${hint ? html`<p class="muted small">${hint}</p>` : ''}
    <ul class="rows">${items.map((i) => purchaseRow(i, fmt))}</ul></section>` : '');
  return html`
    <section class="card">
      <div class="card-head"><h2>Money free for purchases</h2>${tag('forecast')}</div>
      <div class="big-number ${plan.free < 0 ? 'neg' : ''}">${fmt(plan.free)}</div>
      <p class="small muted">Cash on hand ${fmt(s.cash)} minus bills due by payday (${fmt(s.billsTotal)}), savings still to set aside (${fmt(s.savingsReserve)})${plan.essentialsCounted ? html` and your usual essentials until ${D.fmtShort(s.nextPayday)} (${fmt(s.essentialsNeeded)})` : ''}.
        ${plan.essentialsCounted ? '' : 'Record expenses for a week so your usual essential spending is included.'}</p>
      ${plan.nextPeriod.limiting ? html`<p class="small warn-text">${ico('warning')}<span>Limited by your next pay period: even with ${fmt(plan.nextPeriod.income)} expected on payday, bills due until ${D.fmtShort(plan.nextPeriod.end)} (${fmt(plan.nextPeriod.bills)}), savings (${fmt(plan.nextPeriod.savings)}) and essentials (${fmt(plan.nextPeriod.essentials)}) leave only ${fmt(plan.nextPeriod.free)}.</span></p>`
        : html`<p class="small muted">Also checked: next pay period's bills, savings and essentials stay covered with the salary you expect on ${D.fmtShort(s.nextPayday)}.</p>`}
      <form class="afford" data-submit="afford">
        <label for="afford-price">Can I afford something?</label>
        <div class="afford-row">
          <div class="money-input"><span>${ctx.symbol}</span><input id="afford-price" name="price" inputmode="decimal" autocomplete="off" placeholder="Price" value="${r?.input || ''}"></div>
          <button class="btn btn-primary" type="submit">Check</button>
        </div>
        ${r ? html`<p class="afford-result ${r.ok ? 'ok' : 'no'}" role="status">${ico(r.ok ? 'good' : 'warning')}<span>${r.message}</span></p>` : ''}
      </form>
    </section>
    ${plan.items.length || plan.postponed.length ? '' : empty('No planned purchases', 'List things you need or want to buy. The app ranks them and tells you what fits your budget.', '')}
    ${list('Buy first', buy, 'Affordable now, in priority order, after bills, savings and essentials.')}
    ${list('Wait until you have enough', wait, 'Needed, but there is not enough free money yet. Consider postponing optional items first.')}
    ${list('Postpone to save money', postpone, 'Optional items that do not fit right now.')}
    ${plan.postponed.length ? list('Postponed', plan.postponed, null) : ''}
    <div class="center"><button class="btn btn-primary" data-action="add-purchase">${ico('plus')} Add item</button></div>
    ${bought.length ? html`<section class="card"><div class="card-head"><h2>Recently bought</h2>${tag('actual')}</div>
      <ul class="rows">${bought.map((p) => html`<li class="row"><div class="row-main"><strong>${p.name}</strong><small>${p.boughtDate ? D.fmtLong(p.boughtDate) : ''}</small></div><span class="amount">${fmt(p.actualPrice ?? p.price)}</span></li>`)}</ul></section>` : ''}`;
}

export function affordMessage(chk, price, fmt) {
  if (chk.ok) return `Yes. After buying it you would still have ${fmt(chk.left)} free until ${D.fmtShort(chk.nextPayday)}${chk.committed ? `, keeping ${fmt(chk.committed)} for your essential and important planned items` : ''}.`;
  if (chk.okIgnoringPlans) return `Only by delaying your planned essential/important items. You would be ${fmt(-chk.left)} short for them before ${D.fmtShort(chk.nextPayday)}.`;
  return `Not right now. You would be ${fmt(price - Math.max(0, chk.free))} short before ${D.fmtShort(chk.nextPayday)} after bills, savings${chk.essentialsCounted ? ' and essentials' : ''}.`;
}

function budget() {
  const { state, today, fmt } = ctx;
  const b = C.budgetStatus(state, today);
  const budgeted = b.rows.filter((r) => r.budget > 0);
  const others = b.rows.filter((r) => !r.budget && r.spent > 0);
  const level = { over: 'critical', near: 'warning', ok: 'accent' };
  return html`
    <section class="card">
      <div class="card-head"><h2>${D.fmtMonth(today)}</h2><button class="btn btn-small" data-action="edit-budgets">${ico('edit')} Edit budgets</button></div>
      ${b.totalBudget ? html`
        <div class="budget-total">
          <div><span class="muted small">Spent in budgeted categories</span><div class="big-number">${fmt(b.totalSpentBudgeted)} <small class="muted">of ${fmt(b.totalBudget)}</small></div></div>
          ${status(b.totalStatus)}
        </div>
        ${meter(b.totalSpentBudgeted / b.totalBudget, level[b.totalStatus])}
        <p class="muted small">Day ${b.dayOfMonth} of ${b.daysInMonth} · ${Math.round((b.dayOfMonth / b.daysInMonth) * 100)}% of the month gone.</p>`
        : html`<p class="muted">No budgets yet. Set monthly limits for the categories you want to control. Insights can suggest amounts from your records.</p>`}
    </section>
    ${budgeted.length ? html`<section class="card"><ul class="budget-list">${budgeted.map((r) => html`
      <li>
        <div class="budget-line"><strong>${r.label}</strong>${status(r.status)}</div>
        ${meter(r.spent / r.budget, level[r.status])}
        <div class="budget-line small"><span>${fmt(r.spent)} of ${fmt(r.budget)}</span>
          <span class="${r.budget - r.spent < 0 ? 'neg' : 'muted'}">${r.budget - r.spent >= 0 ? `${fmt(r.budget - r.spent)} left` : `${fmt(r.spent - r.budget)} over`}</span></div>
        ${r.paceOver ? html`<p class="small warn-text">${ico('warning')} At this pace you will spend about ${fmt(r.projected)} this month.</p>` : ''}
      </li>`)}</ul></section>` : ''}
    ${others.length ? html`<section class="card"><div class="card-head"><h2>Without a budget</h2></div>
      <ul class="rows">${others.map((r) => html`<li class="row"><div class="row-main"><strong>${r.label}</strong><small>Projected ${fmt(r.projected)} this month</small></div><span class="amount">${fmt(r.spent)}</span></li>`)}</ul></section>` : ''}`;
}

export function render(route) {
  const sub = SECTIONS.some((s) => s.key === route.sub) ? route.sub : 'purchases';
  return html`
    ${pageHead('Plan')}
    ${tabs('plan', sub, SECTIONS)}
    ${sub === 'budget' ? budget() : purchases()}`;
}
