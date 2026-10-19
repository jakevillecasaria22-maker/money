// Pure financial calculations: plain data in, numbers out. No DOM and no storage, so
// everything here runs (and is tested) in Node as well as the browser.
// Amounts are integer cents. Dates are 'YYYY-MM-DD' local calendar dates.

import {
  addDays, addMonths, diffDays, makeDate, parts, startOfMonth, endOfMonth,
  startOfWeek, monthKey, maxDate, minDate, fmtShort,
} from './dates.js';

export const EXPENSE_CATEGORIES = [
  { key: 'food', label: 'Food', essential: true },
  { key: 'transportation', label: 'Transportation', essential: true },
  { key: 'fuel', label: 'Fuel', essential: true },
  { key: 'motorcycle', label: 'Motorcycle maintenance', essential: true },
  { key: 'groceries', label: 'Groceries', essential: true },
  { key: 'personal', label: 'Personal needs', essential: true },
  { key: 'shopping', label: 'Shopping', essential: false },
  { key: 'other', label: 'Other', essential: false },
];

export const BILL_CATEGORIES = [
  { key: 'electricity', label: 'Electricity' },
  { key: 'water', label: 'Water' },
  { key: 'internet', label: 'Internet' },
  { key: 'phone', label: 'Phone' },
  { key: 'rent', label: 'Rent' },
  { key: 'loan', label: 'Loan' },
  { key: 'credit_card', label: 'Credit card' },
  { key: 'subscription', label: 'Subscription' },
  { key: 'other', label: 'Other obligation' },
];

export const PRIORITIES = [
  { key: 'essential', label: 'Essential', rank: 0, hint: 'Necessary for daily living or work' },
  { key: 'important', label: 'Important', rank: 1, hint: 'Needed soon, not urgent' },
  { key: 'optional', label: 'Optional', rank: 2, hint: 'Can be postponed to save money' },
];

export const INCOME_KINDS = [
  { key: 'salary', label: 'Salary' },
  { key: 'allowance', label: 'Allowance' },
  { key: 'other', label: 'Other income' },
];

export const BILL_FREQS = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'once', label: 'One time' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  id: 'settings',
  type: 'settings',
  currency: 'PHP',
  paydays: [5, 20],
  openingDate: null,
  openingCash: 0,
  openingSavings: 0,
  savingsPerPayday: 0,
  goalName: '',
  goalTarget: 0,
  goalDate: null,
  budgets: {},
  reminderDays: 3,
  reminderHour: 8,
  notifyNames: false,
  autoLockMinutes: 5,
});

export function emptyState() {
  return {
    settings: { ...DEFAULT_SETTINGS, budgets: {} },
    incomeSources: [], income: [], bills: [], billPayments: [],
    expenses: [], savings: [], purchases: [],
  };
}

const label = (list, key) => list.find((c) => c.key === key)?.label ?? 'Other';
export const expenseLabel = (key) => label(EXPENSE_CATEGORIES, key);
export const billLabel = (key) => label(BILL_CATEGORIES, key);
export const priorityOf = (key) => PRIORITIES.find((p) => p.key === key) ?? PRIORITIES[2];
const isEssentialCat = (key) => EXPENSE_CATEGORIES.find((c) => c.key === key)?.essential ?? false;

const sum = (arr, f = (x) => x.amount) => arr.reduce((t, x) => t + (f(x) || 0), 0);
const inRange = (d, from, to) => d >= from && d <= to;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const CENTS_100 = 10000;
export const DAYS_PER_MONTH = 30.44;

// ---------------------------------------------------------------- paydays

function cleanDays(days) {
  return [...new Set((days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31))].sort((a, b) => a - b);
}

/** Every date in [from, to] that falls on one of the given days of the month (clamped to month end). */
export function paydaysBetween(days, from, to) {
  const list = cleanDays(days);
  if (!list.length || from > to) return [];
  const out = new Set();
  const s = parts(from);
  const e = parts(to);
  for (let i = 0; ; i++) {
    const yy = s.y + Math.floor((s.m - 1 + i) / 12);
    const mm = ((s.m - 1 + i) % 12) + 1;
    if (yy > e.y || (yy === e.y && mm > e.m)) break;
    for (const d of list) {
      const date = makeDate(yy, mm, d);
      if (inRange(date, from, to)) out.add(date);
    }
  }
  return [...out].sort();
}

/** Pay periods follow the days of active monthly salary sources; the settings
 *  schedule (default 5th and 20th) applies until a salary is added. */
export function getPaydays(state) {
  const fromSalary = cleanDays(state.incomeSources
    .filter((s) => s.active !== false && s.kind === 'salary' && s.freq !== 'once')
    .flatMap((s) => s.days || []));
  return fromSalary.length ? fromSalary : cleanDays(state.settings.paydays);
}

/** Current pay period: start = latest payday on/before today, next = first payday after today. */
export function payPeriod(days, today) {
  const list = paydaysBetween(days, addMonths(startOfMonth(today), -2), endOfMonth(addMonths(startOfMonth(today), 2)));
  if (!list.length) return { start: startOfMonth(today), next: addDays(endOfMonth(today), 1) };
  const start = [...list].reverse().find((d) => d <= today);
  const next = list.find((d) => d > today);
  return { start, next };
}

// ---------------------------------------------------------------- income

export function incomeOccurrences(src, from, to) {
  if (src.active === false) return [];
  const ok = (d) => inRange(d, from, to) && (!src.startDate || d >= src.startDate) && (!src.endDate || d <= src.endDate);
  if (src.freq === 'once') {
    return src.date && ok(src.date) ? [{ sourceId: src.id, source: src, date: src.date, amount: src.amount }] : [];
  }
  return paydaysBetween(src.days, from, to).filter(ok)
    .map((date) => ({ sourceId: src.id, source: src, date, amount: src.amount }));
}

/** Scheduled income in [from, to], each flagged with the actual income record that settled it. */
export function expectedIncome(state, from, to) {
  const received = new Map();
  for (const r of state.income) if (r.sourceId && r.dueDate) received.set(`${r.sourceId}|${r.dueDate}`, r);
  return state.incomeSources
    .flatMap((s) => incomeOccurrences(s, from, to))
    .map((o) => ({ ...o, key: `${o.sourceId}|${o.date}`, received: received.get(`${o.sourceId}|${o.date}`) || null }))
    .sort((a, b) => byDate(a, b) || a.source.name.localeCompare(b.source.name));
}

/** The scheduled payment (same type, not yet received, within 10 days) that a manually recorded
 *  income most likely settles, so it is not also counted as still expected. */
export function matchScheduledIncome(state, kind, date) {
  const tracked = state.settings.openingDate || '0000-01-01';
  const candidates = expectedIncome(state, addDays(date, -10), addDays(date, 10))
    .filter((o) => !o.received && o.source.kind === kind && o.date >= tracked);
  candidates.sort((a, b) => Math.abs(diffDays(a.date, date)) - Math.abs(diffDays(b.date, date)));
  return candidates[0] || null;
}

export function nextSalary(state, today) {
  const { next } = payPeriod(getPaydays(state), today);
  const occ = expectedIncome(state, addDays(today, -45), addDays(today, 70)).filter((o) => o.source.kind === 'salary');
  // Occurrences before tracking began are covered by the opening balance, not "pending".
  const tracked = state.settings.openingDate || '0000-01-01';
  const pending = occ.filter((o) => !o.received && o.date <= today && o.date >= tracked);
  const atNext = occ.filter((o) => o.date === next);
  return { date: next, amount: sum(atNext), hasSchedule: occ.length > 0, pending };
}

// ---------------------------------------------------------------- bills

/** Due dates of a bill within [from, to]. firstDue is the anchor (the first unpaid due date). */
export function billOccurrences(bill, from, to) {
  if (bill.active === false || !bill.firstDue) return [];
  const out = [];
  const interval = Math.max(1, Number(bill.interval) || 1);
  const anchorDay = parts(bill.firstDue).d;
  for (let k = 0; k < 10000; k++) {
    let due;
    if (bill.freq === 'once') {
      if (k > 0) break;
      due = bill.firstDue;
    } else if (bill.freq === 'weekly') due = addDays(bill.firstDue, 7 * interval * k);
    else if (bill.freq === 'yearly') due = addMonths(bill.firstDue, 12 * interval * k, anchorDay);
    else due = addMonths(bill.firstDue, interval * k, anchorDay);
    if (due > to || (bill.endDate && due > bill.endDate)) break;
    if (due >= from) out.push({ billId: bill.id, bill, due, amount: bill.amount, key: `${bill.id}|${due}` });
  }
  return out;
}

export function billStatus(due, today, reminderDays) {
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (diffDays(today, due) <= reminderDays) return 'soon';
  return 'upcoming';
}

function paymentIndex(state) {
  const idx = new Map();
  for (const p of state.billPayments) idx.set(`${p.billId}|${p.dueDate}`, p);
  return idx;
}

/** All bill occurrences due on or before `to` (from the bill's first due date, or `from`),
 *  each with its payment record (if paid) and status. */
export function billSchedule(state, to, today, from = '0000-01-01') {
  const idx = paymentIndex(state);
  const rd = state.settings.reminderDays ?? 3;
  return state.bills
    .flatMap((b) => billOccurrences(b, from, to))
    .map((o) => {
      const payment = idx.get(o.key) || null;
      return { ...o, payment, status: payment ? 'paid' : billStatus(o.due, today, rd) };
    })
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.bill.name.localeCompare(b.bill.name)));
}

/** Unpaid occurrences due on or before `through`, overdue ones included. */
export const unpaidBills = (state, through, today) => billSchedule(state, through, today).filter((o) => !o.payment);

export function monthlyEquivalent(bill, today) {
  if (bill.active === false || bill.freq === 'once') return 0;
  if (today && bill.endDate && bill.endDate < today) return 0;
  const i = Math.max(1, Number(bill.interval) || 1);
  if (bill.freq === 'weekly') return Math.round((bill.amount * 52) / 12 / i);
  if (bill.freq === 'yearly') return Math.round(bill.amount / 12 / i);
  return Math.round(bill.amount / i);
}

export function describeRecurrence(bill) {
  const i = Math.max(1, Number(bill.interval) || 1);
  const day = parts(bill.firstDue || '2000-01-01').d;
  if (bill.freq === 'once') return 'One time';
  if (bill.freq === 'weekly') return i === 1 ? 'Every week' : `Every ${i} weeks`;
  if (bill.freq === 'yearly') return i === 1 ? 'Every year' : `Every ${i} years`;
  const every = i === 1 ? 'Monthly' : i === 3 ? 'Quarterly' : i === 6 ? 'Every 6 months' : `Every ${i} months`;
  return `${every} on day ${day}`;
}

// ---------------------------------------------------------------- balances

/** Actual cash on hand: the opening balance plus every recorded transaction dated
 *  on/after the opening date and on/before asOf. Earlier records only feed reports. */
export function cashBalance(state, asOf) {
  const s = state.settings;
  const open = s.openingDate || '0000-01-01';
  const ok = (d) => d >= open && d <= asOf;
  return (s.openingCash || 0)
    + sum(state.income.filter((r) => ok(r.date)))
    - sum(state.expenses.filter((r) => ok(r.date)))
    - sum(state.billPayments.filter((r) => ok(r.paidDate)))
    - sum(state.savings.filter((r) => ok(r.date)));
}

export function savingsBalance(state, asOf) {
  const s = state.settings;
  const open = s.openingDate || '0000-01-01';
  return (s.openingSavings || 0) + sum(state.savings.filter((r) => r.date >= open && r.date <= asOf));
}

// ---------------------------------------------------------------- spending

/** Recorded expenses over the last `lookback` days (or since tracking began, if shorter). */
export function spendingStats(state, today, lookback = 90) {
  const exps = state.expenses.filter((e) => e.date <= today);
  if (!exps.length) return null;
  let first = exps.reduce((m, e) => (e.date < m ? e.date : m), exps[0].date);
  if (state.settings.openingDate && state.settings.openingDate <= today) first = minDate(first, state.settings.openingDate);
  const start = maxDate(first, addDays(today, -(lookback - 1)));
  const days = diffDays(start, today) + 1;
  const items = exps.filter((e) => e.date >= start);
  const byCategory = {};
  for (const e of items) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  const total = sum(items);
  const essentialTotal = sum(items.filter((e) => isEssentialCat(e.category)));
  return { start, days, items, total, byCategory, dailyAvg: total / days, dailyEssential: essentialTotal / days };
}

export function spendingTotals(state, today) {
  const exp = state.expenses;
  const bills = state.billPayments;
  const between = (from) => sum(exp.filter((e) => inRange(e.date, from, today)));
  const billsBetween = (from) => sum(bills.filter((p) => inRange(p.paidDate, from, today)));
  const mStart = startOfMonth(today);
  const dom = parts(today).d;
  return {
    today: between(today),
    week: between(startOfWeek(today)),
    month: between(mStart),
    billsToday: billsBetween(today),
    billsWeek: billsBetween(startOfWeek(today)),
    billsMonth: billsBetween(mStart),
    dailyAvgMonth: Math.round(between(mStart) / dom),
  };
}

// ---------------------------------------------------------------- safe to spend

/** How much can be spent until the next payday without touching money that is
 *  already needed for bills, the savings plan, or purchases planned before payday.
 *  Uses actual cash only; expected income is never counted as spendable. */
export function safeToSpend(state, today) {
  const { start, next } = payPeriod(getPaydays(state), today);
  const cash = cashBalance(state, today);
  const bills = unpaidBills(state, next, today);
  const billsTotal = sum(bills);
  const savedThisPeriod = sum(state.savings.filter((s) => inRange(s.date, start, today)));
  const savingsPlanned = state.settings.savingsPerPayday || 0;
  const savingsReserve = Math.max(0, savingsPlanned - savedThisPeriod);
  const purchases = state.purchases.filter((p) => p.status === 'planned' && p.targetDate && p.targetDate <= next);
  const purchasesTotal = sum(purchases, (p) => p.price);
  const available = cash - billsTotal - savingsReserve - purchasesTotal;
  const daysLeft = Math.max(1, diffDays(today, next));
  const stats = spendingStats(state, today, 30);
  const essentialDaily = stats && stats.days >= 7 ? Math.round(stats.dailyEssential) : null;
  return {
    today, periodStart: start, nextPayday: next, daysLeft,
    cash, bills, billsTotal,
    savingsPlanned, savedThisPeriod, savingsReserve,
    purchases, purchasesTotal,
    available,
    perDay: available > 0 ? Math.floor(available / daysLeft) : 0,
    essentialDaily,
    essentialsNeeded: essentialDaily != null ? essentialDaily * daysLeft : null,
    statsDays: stats?.days || 0,
    spentToday: sum(state.expenses.filter((e) => e.date === today)),
  };
}

// ---------------------------------------------------------------- month allocation

/** Salary allocation for the month containing `today`.
 *  remaining = carried over + income (received + expected) - bills (paid + unpaid)
 *              - expenses - planned purchases - savings (set aside + still to set aside). */
export function monthAllocation(state, today) {
  const from = startOfMonth(today);
  const to = endOfMonth(today);
  const open = state.settings.openingDate || '0000-01-01';
  const effStart = maxDate(from, open);
  const carryOver = cashBalance(state, addDays(effStart, -1));
  const ok = (d) => inRange(d, effStart, today);

  const incomeReceived = sum(state.income.filter((r) => ok(r.date)));
  const expected = expectedIncome(state, effStart, to).filter((o) => !o.received);
  const incomeExpected = sum(expected);

  const billsPaid = sum(state.billPayments.filter((p) => ok(p.paidDate)));
  const unpaid = unpaidBills(state, to, today);
  const billsUnpaid = sum(unpaid);
  const overdueFromBefore = sum(unpaid.filter((o) => o.due < from));

  const expensesPaid = sum(state.expenses.filter((e) => ok(e.date)));
  const purchases = state.purchases.filter((p) => p.status === 'planned' && p.targetDate && p.targetDate <= to);
  const purchasesPlanned = sum(purchases, (p) => p.price);

  const paydaysInMonth = paydaysBetween(getPaydays(state), from, to).length;
  const savingsPlanned = (state.settings.savingsPerPayday || 0) * paydaysInMonth;
  const savingsDone = sum(state.savings.filter((s) => ok(s.date)));
  const savingsRemaining = Math.max(0, savingsPlanned - savingsDone);

  const remaining = carryOver + incomeReceived + incomeExpected
    - billsPaid - billsUnpaid - expensesPaid - purchasesPlanned - savingsDone - savingsRemaining;

  return {
    from, to, carryOver,
    incomeReceived, incomeExpected, incomeTotal: incomeReceived + incomeExpected, expected,
    billsPaid, billsUnpaid, overdueFromBefore, billsTotal: billsPaid + billsUnpaid,
    expensesPaid, purchasesPlanned, purchases,
    savingsPlanned, savingsDone, savingsRemaining,
    remaining,
  };
}

// ---------------------------------------------------------------- budgets

export function budgetStatus(state, today) {
  const from = startOfMonth(today);
  const dim = parts(endOfMonth(today)).d;
  const dom = parts(today).d;
  const spent = {};
  for (const e of state.expenses) if (inRange(e.date, from, today)) spent[e.category] = (spent[e.category] || 0) + e.amount;
  const budgets = state.settings.budgets || {};
  const rows = EXPENSE_CATEGORIES.map((c) => {
    const budget = budgets[c.key] || 0;
    const s = spent[c.key] || 0;
    const status = !budget ? 'none' : s > budget ? 'over' : s >= budget * 0.8 ? 'near' : 'ok';
    const projected = Math.round((s / dom) * dim);
    return { ...c, budget, spent: s, pct: budget ? s / budget : null, status, projected, paceOver: status === 'ok' && projected > budget };
  });
  const budgeted = rows.filter((r) => r.budget > 0);
  const totalBudget = sum(budgeted, (r) => r.budget);
  const totalSpentBudgeted = sum(budgeted, (r) => r.spent);
  return {
    rows,
    totalBudget,
    totalSpent: sum(rows, (r) => r.spent),
    totalSpentBudgeted,
    totalStatus: !totalBudget ? 'none' : totalSpentBudgeted > totalBudget ? 'over' : totalSpentBudgeted >= totalBudget * 0.8 ? 'near' : 'ok',
    dayOfMonth: dom,
    daysInMonth: dim,
  };
}

/** Categories whose budget status got worse between two budgetStatus results (ok -> near -> over). */
export function budgetCrossings(before, after) {
  const rank = { none: 0, ok: 0, near: 1, over: 2 };
  return after.rows.filter((r) => {
    const prev = before.rows.find((b) => b.key === r.key);
    return rank[r.status] > rank[prev?.status ?? 'none'];
  });
}

// ---------------------------------------------------------------- purchases

/** Ranks planned purchases (priority, then target date) and checks each against money that is
 *  free after bills, the savings plan and usual essential spending. Free money is the lower of:
 *   - now until the next payday, from actual cash only, and
 *   - through the following pay period, adding the income expected on the next payday,
 *  so a purchase today never leaves next period's bills uncovered. */
export function purchasePlan(state, today) {
  const s = safeToSpend(state, today);
  const freeNow = s.cash - s.billsTotal - s.savingsReserve - (s.essentialsNeeded ?? 0);
  const next2 = payPeriod(getPaydays(state), s.nextPayday).next;
  const tracked = state.settings.openingDate || '0000-01-01';
  const income2 = sum(expectedIncome(state, today, addDays(next2, -1)).filter((o) => !o.received && o.date >= tracked));
  const bills2 = sum(unpaidBills(state, next2, today));
  const savings2 = s.savingsReserve + (state.settings.savingsPerPayday || 0);
  const essentials2 = s.essentialDaily != null ? s.essentialDaily * diffDays(today, next2) : 0;
  const freeNextPeriod = s.cash + income2 - bills2 - savings2 - essentials2;
  const free = Math.min(freeNow, freeNextPeriod);
  const planned = state.purchases
    .filter((p) => p.status === 'planned')
    .sort((a, b) => priorityOf(a.priority).rank - priorityOf(b.priority).rank
      || (a.targetDate || '9999-12-31').localeCompare(b.targetDate || '9999-12-31')
      || (a.createdAt || 0) - (b.createdAt || 0));
  let running = free;
  const items = planned.map((p, i) => {
    let verdict;
    let shortBy = 0;
    if (p.price <= running) {
      verdict = 'buy';
      running -= p.price;
    } else {
      shortBy = p.price - Math.max(running, 0);
      verdict = p.priority === 'optional' ? 'postpone' : 'wait';
    }
    return { purchase: p, order: i + 1, verdict, shortBy };
  });
  return {
    summary: s, free, freeNow, essentialsCounted: s.essentialsNeeded != null,
    nextPeriod: { end: next2, income: income2, bills: bills2, savings: savings2, essentials: essentials2, free: freeNextPeriod, limiting: freeNextPeriod < freeNow },
    items,
    postponed: state.purchases.filter((p) => p.status === 'postponed'),
    plannedTotal: sum(planned, (p) => p.price),
    optionalTotal: sum(planned.filter((p) => p.priority === 'optional'), (p) => p.price),
  };
}

export function checkAffordability(state, today, price) {
  const plan = purchasePlan(state, today);
  const committed = sum(plan.items.filter((i) => i.verdict === 'buy' && i.purchase.priority !== 'optional'), (i) => i.purchase.price);
  const afterAll = plan.free - price;
  const afterPriorities = plan.free - committed - price;
  return {
    free: plan.free,
    committed,
    ok: afterPriorities >= 0,
    okIgnoringPlans: afterAll >= 0,
    left: afterPriorities,
    essentialsCounted: plan.essentialsCounted,
    nextPayday: plan.summary.nextPayday,
  };
}

// ---------------------------------------------------------------- forecast

/** Day-by-day projection of cash from today until the next payday. Day one starts from
 *  actual cash; every later value is a forecast built from scheduled bills, planned
 *  purchases, expected income and the recent average daily spending. */
export function forecast(state, today) {
  const s = safeToSpend(state, today);
  const next = s.nextPayday;
  const stats = spendingStats(state, today, 30);
  const hasPace = !!stats && stats.days >= 7;
  const daily = hasPace ? Math.round(stats.dailyAvg) : 0;
  const unpaid = unpaidBills(state, next, today);
  const income = expectedIncome(state, today, next).filter((o) => !o.received);
  const purchases = state.purchases.filter((p) => p.status === 'planned' && p.targetDate && p.targetDate <= next);

  const points = [];
  let bal = s.cash;
  points.push({ date: today, balance: bal, kind: 'actual', events: [] });
  for (let d = today; d <= next; d = addDays(d, 1)) {
    const events = [];
    const isToday = d === today;
    for (const o of unpaid) if (o.due === d || (isToday && o.due < today)) { bal -= o.amount; events.push({ type: 'bill', label: o.bill.name, amount: -o.amount }); }
    for (const p of purchases) if (p.targetDate === d || (isToday && p.targetDate < today)) { bal -= p.price; events.push({ type: 'purchase', label: p.name, amount: -p.price }); }
    if (isToday && s.savingsReserve) { bal -= s.savingsReserve; events.push({ type: 'savings', label: 'Savings plan', amount: -s.savingsReserve }); }
    for (const o of income) if (o.date === d && d !== next) { bal += o.amount; events.push({ type: 'income', label: o.source.name, amount: o.amount }); }
    if (d !== next) {
      const spend = isToday ? Math.max(0, daily - s.spentToday) : daily;
      bal -= spend;
    }
    points.push({ date: d, balance: bal, kind: 'forecast', events });
  }
  const paydayIncome = sum(income.filter((o) => o.date === next));
  const lowest = points.reduce((m, p) => (p.balance < m.balance ? p : m), points[0]);
  return { points, nextPayday: next, dailySpend: daily, hasPace, paceDays: stats?.days || 0, endBalance: bal, paydayIncome, lowest };
}

// ---------------------------------------------------------------- reports

export function monthlySeries(state, today, months = 6) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(startOfMonth(today), -i);
    const key = monthKey(m);
    const income = sum(state.income.filter((r) => monthKey(r.date) === key));
    const expenses = sum(state.expenses.filter((r) => monthKey(r.date) === key));
    const bills = sum(state.billPayments.filter((r) => monthKey(r.paidDate) === key));
    const saved = sum(state.savings.filter((r) => monthKey(r.date) === key));
    out.push({ month: m, income, expenses, bills, outflow: expenses + bills, saved, net: income - expenses - bills });
  }
  return out;
}

/** Spending per day (last 14 days), week (last 8 weeks) or month (last 6 months). */
export function spendingSeries(state, today, unit) {
  const buckets = [];
  if (unit === 'day') for (let i = 13; i >= 0; i--) { const d = addDays(today, -i); buckets.push({ from: d, to: d }); }
  else if (unit === 'week') for (let i = 7; i >= 0; i--) { const f = addDays(startOfWeek(today), -7 * i); buckets.push({ from: f, to: addDays(f, 6) }); }
  else for (let i = 5; i >= 0; i--) { const f = addMonths(startOfMonth(today), -i); buckets.push({ from: f, to: endOfMonth(f) }); }
  return buckets.map((b) => ({
    ...b,
    expenses: sum(state.expenses.filter((e) => inRange(e.date, b.from, b.to))),
    bills: sum(state.billPayments.filter((p) => inRange(p.paidDate, b.from, b.to))),
  }));
}

export function categoryBreakdown(state, from, to) {
  const rows = new Map();
  for (const e of state.expenses) {
    if (!inRange(e.date, from, to)) continue;
    const k = `e:${e.category}`;
    rows.set(k, { key: k, label: expenseLabel(e.category), kind: 'expense', amount: (rows.get(k)?.amount || 0) + e.amount });
  }
  for (const p of state.billPayments) {
    if (!inRange(p.paidDate, from, to)) continue;
    const k = `b:${p.category}`;
    rows.set(k, { key: k, label: `${billLabel(p.category)} (bill)`, kind: 'bill', amount: (rows.get(k)?.amount || 0) + p.amount });
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------- recommendations

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export const RECOMMENDATION_RULES = Object.freeze({
  minDays: 14,           // days of recorded expenses before recommending anything
  unusualFactor: 3,      // an expense >= 3x its category's median is flagged
  unusualMinCount: 5,    // ...when the category has at least 5 records
  flexibleCut: 0.2,      // recommended budget trims flexible categories by 20%
  risingFactor: 1.3,     // this month's daily rate 30% above the earlier rate
  risingMinShare: 0.05,  // ...and the increase is at least 5% of total monthly spending
  cushion: 0.1,          // 10% of the surplus stays unallocated
});

/** Savings and spending recommendations computed only from recorded data. */
export function insights(state, today) {
  const R = RECOMMENDATION_RULES;
  const stats = spendingStats(state, today, 90);
  const out = {
    enough: !!stats && stats.days >= R.minDays,
    daysRecorded: stats?.days || 0,
    budget: budgetStatus(state, today),
    subscriptions: state.bills
      .filter((b) => b.category === 'subscription' && monthlyEquivalent(b, today) > 0)
      .map((b) => ({ bill: b, monthly: monthlyEquivalent(b, today) })),
    optionalPurchases: state.purchases.filter((p) => p.priority === 'optional' && (p.status === 'planned' || p.status === 'postponed')),
  };
  out.subscriptionsMonthly = sum(out.subscriptions, (s) => s.monthly);
  out.optionalTotal = sum(out.optionalPurchases, (p) => p.price);
  if (!out.enough) return out;

  const monthlyOf = (total) => Math.round((total / stats.days) * DAYS_PER_MONTH);
  const groups = {};
  for (const e of stats.items) (groups[e.category] ||= []).push(e);

  out.unusual = [];
  for (const [cat, items] of Object.entries(groups)) {
    if (items.length < R.unusualMinCount) continue;
    const med = median(items.map((e) => e.amount));
    for (const e of items) if (med > 0 && e.amount >= R.unusualFactor * med) out.unusual.push({ expense: e, median: Math.round(med), category: cat });
  }
  out.unusual.sort((a, b) => b.expense.amount - a.expense.amount);
  out.unusual = out.unusual.slice(0, 8);
  const unusualIds = new Set(out.unusual.map((u) => u.expense.id));

  const budgets = state.settings.budgets || {};
  out.categories = EXPENSE_CATEGORIES.map((c) => {
    const items = groups[c.key] || [];
    const current = monthlyOf(sum(items));
    const typical = monthlyOf(sum(items.filter((e) => !unusualIds.has(e.id))));
    const budget = budgets[c.key] || 0;
    let recommended = c.essential ? typical : Math.round(typical * (1 - R.flexibleCut));
    if (budget && budget < recommended) recommended = budget;
    return { ...c, current, typical, recommended, budget, cut: Math.max(0, current - recommended) };
  }).filter((r) => r.current > 0 || r.budget > 0);

  out.rising = [];
  const mStart = startOfMonth(today);
  const mDays = diffDays(mStart, today) + 1;
  const priorDays = diffDays(stats.start, mStart);
  if (mDays >= 7 && priorDays >= 14) {
    for (const c of EXPENSE_CATEGORIES) {
      const items = groups[c.key] || [];
      const now = sum(items.filter((e) => e.date >= mStart)) / mDays;
      const prior = sum(items.filter((e) => e.date < mStart)) / priorDays;
      if (prior > 0 && now >= prior * R.risingFactor) {
        out.rising.push({ ...c, nowMonthly: Math.round(now * DAYS_PER_MONTH), priorMonthly: Math.round(prior * DAYS_PER_MONTH) });
      }
    }
  }

  const totalMonthly = sum(out.categories, (r) => r.current);
  out.rising = out.rising
    .filter((r) => r.nowMonthly - r.priorMonthly >= R.risingMinShare * totalMonthly)
    .sort((a, b) => (b.nowMonthly - b.priorMonthly) - (a.nowMonthly - a.priorMonthly))
    .slice(0, 3);

  const paydaysPerMonth = getPaydays(state).length || 1;
  let incomeMonthly = sum(state.incomeSources.filter((s) => s.active !== false && s.freq !== 'once'),
    (s) => s.amount * cleanDays(s.days).length);
  let incomeBasis = 'scheduled';
  if (!incomeMonthly) {
    incomeMonthly = monthlyOf(sum(state.income.filter((r) => inRange(r.date, stats.start, today))));
    incomeBasis = 'recorded';
  }
  const billsMonthly = sum(state.bills, (b) => monthlyEquivalent(b, today));
  const spendingNow = sum(out.categories, (r) => r.current);
  const spendingRecommended = sum(out.categories, (r) => r.recommended);
  const surplusNow = incomeMonthly - billsMonthly - spendingNow;
  const surplusRecommended = incomeMonthly - billsMonthly - spendingRecommended;
  out.savings = {
    noIncome: incomeMonthly <= 0,
    incomeMonthly, incomeBasis, billsMonthly,
    spendingNow, spendingRecommended,
    surplusNow, surplusRecommended,
    recommendedSavings: surplusRecommended > 0 ? Math.floor((surplusRecommended * (1 - R.cushion)) / CENTS_100) * CENTS_100 : 0,
    plannedSavingsMonthly: (state.settings.savingsPerPayday || 0) * paydaysPerMonth,
    paydaysPerMonth,
  };
  return out;
}

// ---------------------------------------------------------------- alerts

/** Warnings for the dashboard. `fmt` formats cents for display. */
export function alerts(state, today, fmt) {
  const out = [];
  const s = safeToSpend(state, today);
  const rd = state.settings.reminderDays ?? 3;
  const sched = unpaidBills(state, addDays(today, rd), today);
  const overdue = sched.filter((o) => o.status === 'overdue');
  const dueToday = sched.filter((o) => o.status === 'today');
  const soon = sched.filter((o) => o.status === 'soon');
  const names = (list) => list.slice(0, 3).map((o) => o.bill.name).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '');
  if (overdue.length) out.push({ level: 'critical', title: `${overdue.length} overdue bill${overdue.length > 1 ? 's' : ''} · ${fmt(sum(overdue))}`, detail: names(overdue), href: '#/bills' });
  if (dueToday.length) out.push({ level: 'warning', title: `Due today: ${fmt(sum(dueToday))}`, detail: names(dueToday), href: '#/bills' });
  if (s.available < 0) out.push({ level: 'critical', title: `Short by ${fmt(-s.available)} before payday`, detail: 'Bills, savings and planned purchases due before your next salary exceed your cash on hand.', href: '#/home' });
  else if (s.essentialDaily != null && s.perDay < s.essentialDaily) out.push({ level: 'warning', title: 'Tight until payday', detail: `You can spend ${fmt(s.perDay)}/day, but your essentials usually cost ${fmt(s.essentialDaily)}/day.`, href: '#/home' });
  const b = budgetStatus(state, today);
  const over = b.rows.filter((r) => r.status === 'over');
  const near = b.rows.filter((r) => r.status === 'near');
  if (over.length) out.push({ level: 'warning', title: `Over budget: ${over.map((r) => r.label).join(', ')}`, detail: over.map((r) => `${r.label} ${fmt(r.spent)} of ${fmt(r.budget)}`).join(' · '), href: '#/plan/budget' });
  if (near.length) out.push({ level: 'info', title: `Approaching budget: ${near.map((r) => r.label).join(', ')}`, detail: near.map((r) => `${r.label} ${Math.round(r.pct * 100)}% used`).join(' · '), href: '#/plan/budget' });
  if (soon.length) out.push({ level: 'info', title: `${soon.length} bill${soon.length > 1 ? 's' : ''} due within ${rd} days · ${fmt(sum(soon))}`, detail: names(soon), href: '#/bills' });
  const ns = nextSalary(state, today);
  if (ns.pending.length) out.push({ level: 'info', title: 'Salary not recorded yet', detail: ns.pending.map((o) => `${o.source.name} (${fmtShort(o.date)})`).join(', '), href: '#/money/income' });
  return out;
}

// ---------------------------------------------------------------- reminders

/** Minimal, amount-free list of unpaid due dates for the service worker and push scheduling.
 *  Bill names are included only when the user allows them on notifications. */
export function reminderDigest(state, today, includeNames) {
  const items = unpaidBills(state, addDays(today, 60), today)
    .filter((o) => o.due >= addDays(today, -60))
    .map((o) => ({ due: o.due, name: includeNames ? o.bill.name : null }));
  return { generated: today, reminderDays: state.settings.reminderDays ?? 3, items };
}

export const OVERDUE_REMINDER_DAYS = 14;

/** Dates (within the horizon) on which at least one reminder applies. */
export function reminderDates(digest, today, horizon = 60) {
  const end = addDays(today, horizon);
  const dates = new Set();
  for (const it of digest.items) {
    const from = maxDate(today, addDays(it.due, -digest.reminderDays));
    const to = minDate(end, addDays(it.due, OVERDUE_REMINDER_DAYS));
    for (let d = from; d <= to; d = addDays(d, 1)) dates.add(d);
  }
  return [...dates].sort();
}

/** Counts used for a notification on a given day (mirrors the service worker's logic). */
export function digestSummary(digest, today) {
  const res = { overdue: [], today: [], soon: [] };
  for (const it of digest.items) {
    const n = diffDays(today, it.due);
    if (n < 0 && n >= -OVERDUE_REMINDER_DAYS) res.overdue.push(it);
    else if (n === 0) res.today.push(it);
    else if (n > 0 && n <= digest.reminderDays) res.soon.push(it);
  }
  return res;
}
