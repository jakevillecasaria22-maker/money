// Record forms: every add/edit/delete flow in the app goes through here.

import * as store from './store.js';
import * as C from './calc.js';
import * as notify from './notify.js';
import { openForm, chooseDialog, toast } from './ui.js';
import { ctx, ui } from './context.js';
import { addDays, fmtDay, fmtLong, ordinal } from './dates.js';

const opts = (list) => list.map((c) => ({ key: c.key, label: c.label }));
const money = (name, label, extra = {}) => ({ name, label, type: 'money', currencySymbol: ctx.symbol, ...extra });

// ------------------------------------------------------------------ expenses

export async function expenseForm(rec = null) {
  const before = C.budgetStatus(ctx.state, ctx.today);
  const linked = rec?.purchaseId && ctx.state.purchases.find((p) => p.id === rec.purchaseId);
  const saved = await openForm({
    title: rec ? 'Edit expense' : 'Add expense',
    values: rec || { date: ctx.today, category: ui.lastCategory },
    fields: [
      money('amount', 'Amount', { required: true, min: 1, autofocus: !rec }),
      { name: 'category', label: 'Category', type: 'chips', options: opts(C.EXPENSE_CATEGORIES), required: true },
      { name: 'date', label: 'Date', type: 'date', required: true, max: ctx.today, maxMessage: 'Expenses are actual transactions, so the date cannot be in the future' },
      { name: 'note', label: 'Note (optional)', type: 'text', placeholder: 'e.g. lunch, gas refill' },
    ],
    onSubmit: (v) => store.save({ ...(rec || {}), type: 'expense', amount: v.amount, category: v.category, date: v.date, note: v.note }),
    onDelete: rec ? async () => {
      if (linked) await store.saveMany([{ ...linked, status: 'planned', boughtDate: null, actualPrice: null, expenseId: null }]);
      await store.remove(rec);
    } : null,
    deleteMessage: linked ? `"${linked.name}" will move back to your planned purchases.` : 'This cannot be undone.',
  });
  if (saved && !saved.deleted) {
    ui.lastCategory = saved.category;
    toast(rec ? 'Expense updated' : `Expense saved · ${ctx.fmt(saved.amount)}`, { type: 'success' });
    budgetWarnings(before);
  }
  return saved;
}

export function budgetWarnings(before) {
  const crossed = C.budgetCrossings(before, C.budgetStatus(ctx.state, ctx.today));
  for (const r of crossed) {
    toast(r.status === 'over' ? `Over budget: ${r.label} (${ctx.fmt(r.spent)} of ${ctx.fmt(r.budget)})` : `${r.label} is at ${Math.round(r.pct * 100)}% of its budget`, { type: 'warning', timeout: 6000 });
  }
  notify.notifyBudget(crossed, ctx.fmt).catch(() => {});
}

// ------------------------------------------------------------------ income

export async function incomeForm(rec = null, occurrence = null) {
  const base = rec || (occurrence
    ? { amount: occurrence.amount, kind: occurrence.source.kind, name: occurrence.source.name, date: occurrence.date <= ctx.today ? occurrence.date : ctx.today, sourceId: occurrence.sourceId, dueDate: occurrence.date }
    : { date: ctx.today, kind: 'salary' });
  const saved = await openForm({
    title: rec ? 'Edit income' : occurrence ? `Received: ${occurrence.source.name}` : 'Record income',
    intro: occurrence ? `Scheduled for ${fmtDay(occurrence.date)}. Enter the amount you actually received.` : null,
    values: base,
    fields: [
      money('amount', 'Amount received', { required: true, min: 1, autofocus: !rec }),
      { name: 'kind', label: 'Type', type: 'chips', options: opts(C.INCOME_KINDS), required: true },
      { name: 'name', label: 'Description', type: 'text', placeholder: 'e.g. Salary, Rice allowance, Freelance', required: true },
      { name: 'date', label: 'Date received', type: 'date', required: true, max: ctx.today, maxMessage: 'Record income on the day it arrives (expected income is shown separately)' },
      { name: 'note', label: 'Note (optional)', type: 'text' },
    ],
    onSubmit: (v) => {
      const link = base.sourceId ? null : C.matchScheduledIncome(ctx.state, v.kind, v.date);
      const extra = link ? { sourceId: link.sourceId, dueDate: link.date } : {};
      return store.save({ ...base, ...extra, type: 'income', amount: v.amount, kind: v.kind, name: v.name, date: v.date, note: v.note });
    },
    onDelete: rec ? () => store.remove(rec) : null,
    deleteMessage: rec?.sourceId ? 'The scheduled payment will show as not received again.' : 'This cannot be undone.',
  });
  if (saved && !saved.deleted) toast(`Income saved · ${ctx.fmt(saved.amount)}${saved.dueDate && !occurrence && !rec ? ` (counted as your ${fmtDay(saved.dueDate)} scheduled payment)` : ''}`, { type: 'success' });
  return saved;
}

export async function incomeSourceForm(rec = null) {
  const paydays = C.getPaydays(ctx.state);
  const values = rec || { kind: 'salary', freq: 'monthly', days: paydays, active: true };
  const saved = await openForm({
    title: rec ? 'Edit scheduled income' : 'Add scheduled income',
    intro: 'Scheduled income is what you expect to receive. It only counts as money you have once you mark it received.',
    values,
    fields: [
      { name: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Salary', required: true, autofocus: !rec },
      { name: 'kind', label: 'Type', type: 'chips', options: opts(C.INCOME_KINDS), required: true },
      money('amount', 'Amount each time', { required: true, min: 1 }),
      { name: 'freq', label: 'Schedule', type: 'select', options: [{ key: 'monthly', label: 'Every month on chosen days' }, { key: 'once', label: 'One time' }] },
      { name: 'days', label: 'Days of the month', type: 'days', required: true, showIf: (v) => v.freq !== 'once', hint: 'Salary days define your pay periods. Day 31 falls on the last day in shorter months.' },
      { name: 'date', label: 'Date', type: 'date', required: true, showIf: (v) => v.freq === 'once' },
      { name: 'endDate', label: 'Ends on (optional)', type: 'date', showIf: (v) => v.freq !== 'once' },
      ...(rec ? [{ name: 'active', label: 'Active', type: 'checkbox' }] : []),
    ],
    onSubmit: (v) => store.save({
      ...(rec || {}), type: 'incomeSource', name: v.name, kind: v.kind, amount: v.amount, freq: v.freq,
      days: v.freq === 'once' ? [] : v.days, date: v.freq === 'once' ? v.date : null,
      endDate: v.freq === 'once' ? null : v.endDate, active: rec ? v.active : true,
    }),
    onDelete: rec ? () => store.remove(rec) : null,
    deleteMessage: 'Income already received stays in your records.',
  });
  if (saved && !saved.deleted) toast('Scheduled income saved', { type: 'success' });
  return saved;
}

export function describeSource(s) {
  if (s.freq === 'once') return `One time · ${fmtLong(s.date)}`;
  const days = (s.days || []).map(ordinal);
  return `Every ${days.length > 1 ? `${days.slice(0, -1).join(', ')} & ${days.at(-1)}` : days[0]}${s.endDate ? ` · until ${fmtLong(s.endDate)}` : ''}`;
}

// ------------------------------------------------------------------ bills

export async function billForm(rec = null) {
  // Editing shows the earliest unpaid due date; the stored anchor only changes if the user edits it.
  const shownDue = rec ? (C.unpaidBills({ ...ctx.state, bills: [rec] }, addDays(ctx.today, 800), ctx.today)[0]?.due || rec.firstDue) : ctx.today;
  const saved = await openForm({
    title: rec ? 'Edit bill' : 'Add bill',
    values: rec ? { ...rec, firstDue: shownDue } : { category: 'electricity', freq: 'monthly', interval: 1, firstDue: ctx.today, active: true },
    fields: [
      { name: 'name', label: 'Bill name', type: 'text', placeholder: 'e.g. Meralco, PLDT, Motorcycle loan', required: true, autofocus: !rec },
      { name: 'category', label: 'Category', type: 'select', options: opts(C.BILL_CATEGORIES) },
      money('amount', 'Amount', { required: true, min: 1 }),
      { name: 'estimate', label: 'Amount varies each time (treat as an estimate)', type: 'checkbox' },
      { name: 'firstDue', label: 'Next due date', type: 'date', required: true, hint: 'The next unpaid due date. Repeats are counted from here.' },
      { name: 'freq', label: 'Repeats', type: 'select', options: opts(C.BILL_FREQS) },
      { name: 'interval', label: 'Every how many?', type: 'number', min: 1, max: 24, showIf: (v) => v.freq !== 'once', hint: '1 = every month/week/year. Use 3 with Monthly for quarterly bills.' },
      { name: 'endDate', label: 'Last due date (optional)', type: 'date', showIf: (v) => v.freq !== 'once', hint: 'For loans or plans that end. Leave empty if it continues.' },
      ...(rec ? [{ name: 'active', label: 'Active (turn off to pause this bill and its reminders)', type: 'checkbox' }] : []),
      { name: 'note', label: 'Note (optional)', type: 'text', placeholder: 'Account number, how to pay…' },
    ],
    validate: (v) => (v.endDate && v.firstDue && v.endDate < v.firstDue ? { endDate: 'Must be on or after the next due date' } : {}),
    onSubmit: (v) => store.save({
      ...(rec || {}), type: 'bill', name: v.name, category: v.category, amount: v.amount, estimate: v.estimate,
      firstDue: rec && v.firstDue === shownDue ? rec.firstDue : v.firstDue,
      freq: v.freq, interval: v.freq === 'once' ? 1 : (v.interval || 1), endDate: v.freq === 'once' ? null : v.endDate,
      active: rec ? v.active : true, note: v.note,
    }),
    onDelete: rec ? () => store.remove(rec) : null,
    deleteMessage: 'Past payments stay in your history. Future reminders for this bill stop.',
  });
  if (saved && !saved.deleted) toast('Bill saved', { type: 'success' });
  return saved;
}

export async function payBillForm(occurrence, payment = null) {
  const bill = occurrence?.bill || ctx.state.bills.find((b) => b.id === payment?.billId);
  const name = bill?.name || payment?.billName || 'Bill';
  const values = payment || { amount: occurrence.amount, paidDate: ctx.today };
  const saved = await openForm({
    title: payment ? `Payment: ${name}` : `Pay ${name}`,
    intro: `Due ${fmtDay(payment?.dueDate || occurrence.due)}${bill ? ` · ${C.describeRecurrence(bill)}` : ''}${bill?.estimate && !payment ? ' · amount is an estimate, enter the actual amount' : ''}`,
    values,
    fields: [
      money('amount', 'Amount paid', { required: true, min: 1, autofocus: !payment }),
      { name: 'paidDate', label: 'Date paid', type: 'date', required: true, max: ctx.today, maxMessage: 'Payments are actual transactions, so the date cannot be in the future' },
      { name: 'note', label: 'Note (optional)', type: 'text', placeholder: 'Reference number' },
    ],
    submitLabel: payment ? 'Save' : 'Mark as paid',
    onSubmit: (v) => store.save({
      ...(payment || {}), type: 'billPayment',
      billId: payment?.billId || occurrence.billId, dueDate: payment?.dueDate || occurrence.due,
      billName: name, category: bill?.category || payment?.category || 'other',
      amount: v.amount, paidDate: v.paidDate, note: v.note,
    }),
    onDelete: payment ? () => store.remove(payment) : null,
    deleteLabel: 'Mark as unpaid',
    deleteConfirm: 'Mark this bill as unpaid?',
    deleteMessage: 'The payment record is removed and the bill shows as unpaid again.',
  });
  if (saved && !saved.deleted) toast(`${name} marked paid`, { type: 'success' });
  return saved;
}

// ------------------------------------------------------------------ savings

export async function savingsForm(rec = null, direction = 'deposit') {
  const values = rec ? { ...rec, amount: Math.abs(rec.amount), direction: rec.amount < 0 ? 'withdraw' : 'deposit' } : { date: ctx.today, direction };
  const saved = await openForm({
    title: rec ? 'Edit savings entry' : direction === 'withdraw' ? 'Withdraw from savings' : 'Add to savings',
    intro: 'Money moved to savings is no longer counted as spendable cash.',
    values,
    fields: [
      { name: 'direction', label: 'Type', type: 'chips', options: [{ key: 'deposit', label: 'Set aside (deposit)' }, { key: 'withdraw', label: 'Take out (withdraw)' }], required: true },
      money('amount', 'Amount', { required: true, min: 1, autofocus: !rec }),
      { name: 'date', label: 'Date', type: 'date', required: true, max: ctx.today },
      { name: 'note', label: 'Note (optional)', type: 'text' },
    ],
    onSubmit: (v) => store.save({ ...(rec || {}), type: 'savings', amount: v.direction === 'withdraw' ? -v.amount : v.amount, date: v.date, note: v.note }),
    onDelete: rec ? () => store.remove(rec) : null,
  });
  if (saved && !saved.deleted) toast('Savings updated', { type: 'success' });
  return saved;
}

// ------------------------------------------------------------------ purchases

export async function purchaseForm(rec = null) {
  const saved = await openForm({
    title: rec ? 'Edit planned purchase' : 'Add planned purchase',
    values: rec || { priority: 'important', status: 'planned' },
    fields: [
      { name: 'name', label: 'Item', type: 'text', placeholder: 'e.g. Rain gear, phone charger', required: true, autofocus: !rec },
      money('price', 'Estimated price', { required: true, min: 1 }),
      { name: 'priority', label: 'Priority', type: 'chips', options: C.PRIORITIES.map((p) => ({ key: p.key, label: p.label })), required: true, hint: 'Essential: needed for daily living or work · Important: needed soon · Optional: can wait' },
      { name: 'targetDate', label: 'Target date (optional)', type: 'date', hint: 'Items with a target date before payday are set aside from your safe-to-spend amount.' },
      ...(rec ? [{ name: 'status', label: 'Status', type: 'select', options: [{ key: 'planned', label: 'Planned' }, { key: 'postponed', label: 'Postponed' }, { key: 'cancelled', label: 'Cancelled' }] }] : []),
      { name: 'note', label: 'Note (optional)', type: 'text' },
    ],
    onSubmit: (v) => store.save({ ...(rec || {}), type: 'purchase', name: v.name, price: v.price, priority: v.priority, targetDate: v.targetDate, status: rec ? v.status : 'planned', note: v.note }),
    onDelete: rec ? () => store.remove(rec) : null,
  });
  if (saved && !saved.deleted) toast('Purchase list updated', { type: 'success' });
  return saved;
}

export async function markBoughtForm(p) {
  const before = C.budgetStatus(ctx.state, ctx.today);
  const saved = await openForm({
    title: `Bought: ${p.name}`,
    intro: 'This records the purchase as an expense.',
    values: { amount: p.price, date: ctx.today, category: 'shopping' },
    fields: [
      money('amount', 'Actual price paid', { required: true, min: 1, autofocus: true }),
      { name: 'date', label: 'Date bought', type: 'date', required: true, max: ctx.today },
      { name: 'category', label: 'Expense category', type: 'chips', options: opts(C.EXPENSE_CATEGORIES), required: true },
    ],
    submitLabel: 'Record purchase',
    onSubmit: async (v) => {
      const [expense] = await store.saveMany([{ type: 'expense', amount: v.amount, category: v.category, date: v.date, note: p.name, purchaseId: p.id }]);
      await store.save({ ...p, status: 'bought', boughtDate: v.date, actualPrice: v.amount, expenseId: expense.id });
      return expense;
    },
  });
  if (saved) {
    toast(`${p.name} recorded · ${ctx.fmt(saved.amount)}`, { type: 'success' });
    budgetWarnings(before);
  }
}

// ------------------------------------------------------------------ budgets & settings

export async function budgetForm() {
  const b = ctx.state.settings.budgets || {};
  const saved = await openForm({
    title: 'Monthly budgets',
    intro: 'Set a monthly limit for the categories you want to watch. Leave empty for no limit.',
    values: b,
    fields: C.EXPENSE_CATEGORIES.map((c) => money(c.key, c.label, { min: 0 })),
    onSubmit: (v) => {
      const budgets = {};
      for (const c of C.EXPENSE_CATEGORIES) if (v[c.key] > 0) budgets[c.key] = v[c.key];
      return store.saveSettings({ budgets });
    },
  });
  if (saved) toast('Budgets saved', { type: 'success' });
}

const CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'AUD', 'CAD', 'AED', 'SAR', 'HKD', 'KRW'].map((c) => ({ key: c, label: c }));

export async function generalSettingsForm() {
  const s = ctx.state.settings;
  const hasSalary = ctx.state.incomeSources.some((x) => x.kind === 'salary' && x.active !== false && x.freq !== 'once');
  const saved = await openForm({
    title: 'Currency and pay schedule',
    values: s,
    fields: [
      { name: 'currency', label: 'Currency', type: 'select', options: CURRENCIES },
      { name: 'paydays', label: 'Paydays (days of the month)', type: 'days', required: true, hint: hasSalary ? 'You have scheduled salary, so pay periods follow its days. This schedule is used only if no salary is scheduled.' : 'Used for pay periods until you add your salary under Money → Income.' },
    ],
    onSubmit: (v) => store.saveSettings({ currency: v.currency, paydays: v.paydays }),
  });
  if (saved) toast('Settings saved', { type: 'success' });
}

export async function openingBalanceForm() {
  const s = ctx.state.settings;
  const saved = await openForm({
    title: 'Starting balances',
    intro: 'The money you had on the date you started tracking. Transactions on or after this date adjust your balance; earlier ones appear only in reports.',
    values: { openingDate: s.openingDate || ctx.today, openingCash: s.openingCash || 0, openingSavings: s.openingSavings || 0 },
    fields: [
      { name: 'openingDate', label: 'Tracking start date', type: 'date', required: true, max: ctx.today },
      money('openingCash', 'Cash and bank money available to spend', { required: true, min: 0 }),
      money('openingSavings', 'Money already in savings', { min: 0 }),
    ],
    onSubmit: (v) => store.saveSettings({ openingDate: v.openingDate, openingCash: v.openingCash || 0, openingSavings: v.openingSavings || 0 }),
  });
  if (saved) toast('Starting balances saved', { type: 'success' });
}

export async function savingsPlanForm() {
  const s = ctx.state.settings;
  const saved = await openForm({
    title: 'Savings plan and goal',
    values: s,
    fields: [
      money('savingsPerPayday', 'Set aside every payday', { min: 0, hint: 'Reserved from your safe-to-spend amount until you move it to savings.' }),
      { name: 'goal', label: 'Savings goal', type: 'heading' },
      { name: 'goalName', label: 'Goal name (optional)', type: 'text', placeholder: 'e.g. Emergency fund' },
      money('goalTarget', 'Target amount', { min: 0 }),
      { name: 'goalDate', label: 'Target date (optional)', type: 'date', min: ctx.today, minMessage: 'Pick a future date' },
    ],
    onSubmit: (v) => store.saveSettings({ savingsPerPayday: v.savingsPerPayday || 0, goalName: v.goalName || '', goalTarget: v.goalTarget || 0, goalDate: v.goalDate }),
  });
  if (saved) toast('Savings plan saved', { type: 'success' });
}

export async function reminderSettingsForm() {
  const s = ctx.state.settings;
  const hours = Array.from({ length: 18 }, (_, i) => i + 5).map((h) => ({ key: h, label: `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}` }));
  const saved = await openForm({
    title: 'Bill reminders',
    values: s,
    fields: [
      { name: 'reminderDays', label: 'Remind me this many days before a bill is due', type: 'number', min: 0, max: 14, required: true },
      { name: 'reminderHour', label: 'Daily reminder time (push notifications)', type: 'select', options: hours },
      { name: 'notifyNames', label: 'Show bill names on notifications (they may appear on your lock screen)', type: 'checkbox' },
    ],
    onSubmit: (v) => store.saveSettings({ reminderDays: v.reminderDays, reminderHour: Number(v.reminderHour), notifyNames: v.notifyNames }),
  });
  if (saved) toast('Reminder settings saved', { type: 'success' });
}

export async function securityForm() {
  const saved = await openForm({
    title: 'Auto-lock',
    values: { autoLockMinutes: ctx.state.settings.autoLockMinutes ?? 5 },
    fields: [{ name: 'autoLockMinutes', label: 'Lock the app after this long without use', type: 'select', options: [1, 5, 15, 30, 60].map((m) => ({ key: m, label: `${m} minute${m > 1 ? 's' : ''}` })) }],
    onSubmit: (v) => store.saveSettings({ autoLockMinutes: Number(v.autoLockMinutes) }),
  });
  if (saved) toast('Auto-lock updated', { type: 'success' });
}

export async function changePinForm() {
  const saved = await openForm({
    title: 'Change PIN',
    fields: [
      { name: 'current', label: 'Current PIN', type: 'password', autocomplete: 'current-password', required: true },
      { name: 'pin', label: 'New PIN (at least 6 digits or characters)', type: 'password', required: true },
      { name: 'confirm', label: 'Repeat new PIN', type: 'password', required: true },
    ],
    validate: (v) => (v.pin.length < 6 ? { pin: 'Use at least 6 digits or characters' } : v.pin !== v.confirm ? { confirm: 'PINs do not match' } : {}),
    onSubmit: (v) => store.changePin(v.current, v.pin),
  });
  if (saved) toast('PIN changed', { type: 'success' });
}

// ------------------------------------------------------------------ quick add

export async function quickAdd() {
  const choice = await chooseDialog({
    title: 'Add',
    options: [
      { key: 'expense', label: 'Expense', hint: 'Money you spent', icon: 'expense' },
      { key: 'income', label: 'Income received', hint: 'Salary, allowance, other', icon: 'income' },
      { key: 'pay', label: 'Pay a bill', hint: 'Mark an upcoming bill as paid', icon: 'bill' },
      { key: 'savings', label: 'Add to savings', icon: 'piggy' },
      { key: 'purchase', label: 'Planned purchase', hint: 'Something you need or want to buy', icon: 'cart' },
      { key: 'bill', label: 'New bill', hint: 'Recurring or one-time obligation', icon: 'calendar' },
    ],
  });
  if (choice === 'expense') return expenseForm();
  if (choice === 'income') return pickIncome();
  if (choice === 'pay') return pickBillToPay();
  if (choice === 'savings') return savingsForm();
  if (choice === 'purchase') return purchaseForm();
  if (choice === 'bill') return billForm();
}

async function pickIncome() {
  const expected = C.expectedIncome(ctx.state, C.monthAllocation(ctx.state, ctx.today).from, ctx.today).filter((o) => !o.received);
  if (!expected.length) return incomeForm();
  const choice = await chooseDialog({
    title: 'Which income?',
    options: [
      ...expected.map((o) => ({ key: o.key, label: `${o.source.name} · ${ctx.fmt(o.amount)}`, hint: `Scheduled ${fmtDay(o.date)}`, icon: 'income' })),
      { key: '__other', label: 'Other income', hint: 'Not on your schedule', icon: 'plus' },
    ],
  });
  if (!choice) return null;
  if (choice === '__other') return incomeForm();
  return incomeForm(null, expected.find((o) => o.key === choice));
}

async function pickBillToPay() {
  const unpaid = C.unpaidBills(ctx.state, C.monthAllocation(ctx.state, ctx.today).to, ctx.today).slice(0, 8);
  if (!unpaid.length) {
    toast('No unpaid bills this month. Add bills under the Bills tab.');
    return null;
  }
  const choice = await chooseDialog({
    title: 'Which bill?',
    options: unpaid.map((o) => ({ key: o.key, label: `${o.bill.name} · ${ctx.fmt(o.amount)}`, hint: `Due ${fmtDay(o.due)}${o.status === 'overdue' ? ' · overdue' : ''}`, icon: 'bill' })),
  });
  const occ = unpaid.find((o) => o.key === choice);
  return occ ? payBillForm(occ) : null;
}
