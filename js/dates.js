// Calendar-date helpers. Every date in the app is a local calendar date string
// 'YYYY-MM-DD'; arithmetic is done in UTC so DST and time zones never shift a day.

const DAY_MS = 86400000;

export const pad = (n) => String(n).padStart(2, '0');

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function toUTC(iso) {
  const { y, m, d } = parts(iso);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s;
}

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY_MS);

/** Whole days from a to b (positive when b is later). */
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);

/** m is 1-12. */
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Builds a date, letting the month overflow into other years and clamping the day
 *  to the month's length (day 31 in February becomes the 28th/29th). */
export function makeDate(y, m, d) {
  const yy = y + Math.floor((m - 1) / 12);
  const mm = (((m - 1) % 12) + 12) % 12 + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(d, daysInMonth(yy, mm)))}`;
}

/** Adds n months, keeping anchorDay (defaults to the date's own day) where the month allows. */
export function addMonths(iso, n, anchorDay) {
  const { y, m, d } = parts(iso);
  return makeDate(y, m + n, anchorDay ?? d);
}

export const monthKey = (iso) => iso.slice(0, 7);
export const startOfMonth = (iso) => iso.slice(0, 8) + '01';
export function endOfMonth(iso) {
  const { y, m } = parts(iso);
  return makeDate(y, m, 31);
}

/** Monday of the week containing iso. */
export function startOfWeek(iso) {
  const dow = new Date(toUTC(iso)).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

export const minDate = (a, b) => (a < b ? a : b);
export const maxDate = (a, b) => (a > b ? a : b);

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const fmtCache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...opts }));
  return fmtCache.get(key);
}

/** "Oct 20" */
export const fmtShort = (iso) => fmt({ month: 'short', day: 'numeric' }).format(toUTC(iso));
/** "Mon, Oct 20" */
export const fmtDay = (iso) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(toUTC(iso));
/** "Oct 20, 2026" */
export const fmtLong = (iso) => fmt({ month: 'short', day: 'numeric', year: 'numeric' }).format(toUTC(iso));
/** "October 2026" */
export const fmtMonth = (iso) => fmt({ month: 'long', year: 'numeric' }).format(toUTC(startOfMonth(iso)));
/** "Oct" */
export const fmtMonthShort = (iso) => fmt({ month: 'short' }).format(toUTC(startOfMonth(iso)));

/** "today", "tomorrow", "in 3 days", "2 days ago" */
export function relDays(iso, today) {
  const n = diffDays(today, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
