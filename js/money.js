// Money is stored as integer cents (centavos) so totals never pick up float rounding errors.

/** Parses user input like "1,234.50", "₱500", "75" into cents. Returns NaN when invalid. */
export function toCents(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : NaN;
  const s = String(input ?? '').trim().replace(/[,\s₱$]/g, '');
  if (!/^-?(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return NaN;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole || 0) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

/** Cents to a plain input value: 123450 -> "1234.50" */
export function centsToInput(cents) {
  if (cents == null || Number.isNaN(cents)) return '';
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const formatters = new Map();
function formatter(currency, compact) {
  const key = currency + (compact ? ':c' : '');
  if (!formatters.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat('en-PH', compact
        ? { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }
        : { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(key, f);
  }
  return formatters.get(key);
}

export function formatMoney(cents, currency = 'PHP') {
  return formatter(currency, false).format((cents || 0) / 100);
}

/** Short form for chart axes: ₱12.5K */
export function formatCompact(cents, currency = 'PHP') {
  return formatter(currency, true).format((cents || 0) / 100);
}
