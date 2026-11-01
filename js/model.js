// Default data, constants and pure helpers.

export const MGDL_PER_MMOL = 18.0182;

// Target groups drive default ranges (mg/dL). User can edit them.
export const TARGET_GROUPS = {
  fasting: { label: 'Fasting / before meals', range: [80, 130] },
  post: { label: 'After meals (1–2 h)', range: [80, 180] },
  bedtime: { label: 'Bedtime / overnight', range: [90, 150] },
  other: { label: 'Other / random', range: [70, 180] },
};

export const DEFAULT_READING_TYPES = [
  { id: 'fasting', name: 'Fasting (wake-up)', icon: '🌅', group: 'fasting' },
  { id: 'pre_breakfast', name: 'Before breakfast', icon: '🍳', group: 'fasting' },
  { id: 'post_breakfast', name: 'After breakfast', icon: '🥐', group: 'post' },
  { id: 'pre_lunch', name: 'Before lunch', icon: '🥗', group: 'fasting' },
  { id: 'post_lunch', name: 'After lunch', icon: '🍛', group: 'post' },
  { id: 'pre_dinner', name: 'Before dinner', icon: '🍽️', group: 'fasting' },
  { id: 'post_dinner', name: 'After dinner', icon: '🍲', group: 'post' },
  { id: 'pre_snack', name: 'Before snack', icon: '🍎', group: 'fasting' },
  { id: 'post_snack', name: 'After snack', icon: '🍪', group: 'post' },
  { id: 'bedtime', name: 'Bedtime', icon: '🌙', group: 'bedtime' },
  { id: 'overnight', name: 'Overnight (≈3 AM)', icon: '🌌', group: 'bedtime' },
  { id: 'pre_exercise', name: 'Before exercise', icon: '🏃', group: 'other' },
  { id: 'post_exercise', name: 'After exercise', icon: '💪', group: 'other' },
  { id: 'feeling_low', name: 'Feeling low', icon: '😵', group: 'other' },
  { id: 'feeling_high', name: 'Feeling high / sick day', icon: '🤒', group: 'other' },
  { id: 'random', name: 'Random', icon: '🎲', group: 'other' },
];

export const DEFAULT_ACCOUNT_TYPES = {
  cash: { label: 'Cash', icon: '💵' },
  bank: { label: 'Bank account', icon: '🏦' },
  card: { label: 'Credit card', icon: '💳' },
  wallet: { label: 'Mobile wallet', icon: '📱' },
  savings: { label: 'Savings', icon: '🐖' },
  other: { label: 'Other', icon: '👛' },
};

const C = (id, name, icon, kind, color) => ({ id, name, icon, kind, color, budget: 0 });
export const DEFAULT_CATEGORIES = [
  C('food', 'Food & groceries', '🛒', 'expense', '#e8833a'),
  C('dining', 'Restaurants & cafés', '☕', 'expense', '#d95f5f'),
  C('transport', 'Transport & fuel', '🚗', 'expense', '#4a90d9'),
  C('bills', 'Bills & utilities', '💡', 'expense', '#c9a227'),
  C('rent', 'Rent & home', '🏠', 'expense', '#8e6bd1'),
  C('health', 'Health & medicine', '💊', 'expense', '#2bb39a'),
  C('phone', 'Phone & internet', '📶', 'expense', '#3aa3c7'),
  C('shopping', 'Shopping & clothes', '🛍️', 'expense', '#d16ba5'),
  C('education', 'Education', '📚', 'expense', '#6b8e23'),
  C('family', 'Family & kids', '👨‍👩‍👧', 'expense', '#e0a458'),
  C('fun', 'Entertainment', '🎬', 'expense', '#9b59b6'),
  C('gifts', 'Gifts & charity', '🎁', 'expense', '#c0392b'),
  C('travel', 'Travel', '✈️', 'expense', '#16a085'),
  C('debt', 'Loans & debt payments', '🧾', 'expense', '#7f8c8d'),
  C('other_exp', 'Other expense', '📦', 'expense', '#95a5a6'),
  C('salary', 'Salary', '💼', 'income', '#27ae60'),
  C('business', 'Business / freelance', '🧑‍💻', 'income', '#2e86de'),
  C('investment', 'Investments & profit', '📈', 'income', '#8e44ad'),
  C('rental', 'Rental income', '🏘️', 'income', '#d35400'),
  C('gift_in', 'Gifts received', '🎉', 'income', '#e67e22'),
  C('refund', 'Refunds', '↩️', 'income', '#16a085'),
  C('other_inc', 'Other income', '💰', 'income', '#2ecc71'),
];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function defaultData({ name, currency }) {
  return {
    v: 1,
    profile: { name },
    settings: {
      glucoseUnit: 'mg/dL',
      targets: Object.fromEntries(Object.entries(TARGET_GROUPS).map(([k, g]) => [k, [...g.range]])),
      hypo: 70,
      hyper: 250,
      currency,
      autoLockMin: 3,
      theme: 'auto',
      weekStart: 6, // Saturday
    },
    readingTypes: DEFAULT_READING_TYPES.map((t) => ({ ...t })),
    readings: [],
    accounts: [{ id: uid(), name: 'Cash', type: 'cash', currency, opening: 0 }],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    txns: [],
    tomb: {},
    su: 0,
  };
}

// ---------- Glucose helpers ----------
export const toDisplay = (mgdl, unit) => unit === 'mmol/L' ? +(mgdl / MGDL_PER_MMOL).toFixed(1) : Math.round(mgdl);
export const fromInput = (v, unit) => unit === 'mmol/L' ? v * MGDL_PER_MMOL : v;
export const fmtG = (mgdl, unit) => unit === 'mmol/L' ? (mgdl / MGDL_PER_MMOL).toFixed(1) : String(Math.round(mgdl));

export function status(mgdl, type, data) {
  const s = data.settings;
  if (mgdl < s.hypo) return 'low';
  if (mgdl >= s.hyper) return 'veryhigh';
  const t = data.readingTypes.find((x) => x.id === type);
  const [lo, hi] = s.targets[t?.group || 'other'] || s.targets.other;
  if (mgdl < lo) return 'below';
  if (mgdl > hi) return 'high';
  return 'ok';
}
export const STATUS_LABEL = { low: 'Low', below: 'Below target', ok: 'In range', high: 'Above target', veryhigh: 'Very high' };

export function glucoseStats(readings, data) {
  if (!readings.length) return null;
  const vals = readings.map((r) => r.v);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length);
  let inRange = 0, low = 0, high = 0;
  for (const r of readings) {
    const st = status(r.v, r.type, data);
    if (st === 'ok') inRange++;
    else if (st === 'low' || st === 'below') low++;
    else high++;
  }
  return {
    n: vals.length, avg, sd, min: Math.min(...vals), max: Math.max(...vals),
    inRange: inRange / vals.length, low, high,
    eA1c: (avg + 46.7) / 28.7, // ADAG formula
    cv: avg ? sd / avg : 0,
  };
}

// ---------- Money helpers ----------
export function fmtMoney(amount, currency, opts = {}) {
  try {
    const big = opts.compact && Math.abs(amount) >= 10000;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: big ? 1 : 2, minimumFractionDigits: opts.compact ? 0 : 2, ...(big ? { notation: 'compact' } : {}), ...opts.intl }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function accountBalance(acc, txns) {
  let b = Number(acc.opening) || 0;
  for (const t of txns) {
    if (t.kind === 'income' && t.accountId === acc.id) b += t.amount;
    else if (t.kind === 'expense' && t.accountId === acc.id) b -= t.amount;
    else if (t.kind === 'transfer') {
      if (t.accountId === acc.id) b -= t.amount;
      if (t.toAccountId === acc.id) b += (t.toAmount ?? t.amount);
    }
  }
  return b;
}

// Sum income/expense per currency for a list of transactions (transfers excluded).
export function totalsByCurrency(txns, accounts) {
  const out = {};
  for (const t of txns) {
    if (t.kind === 'transfer') continue;
    const cur = accounts.find((a) => a.id === t.accountId)?.currency || 'USD';
    out[cur] ??= { income: 0, expense: 0 };
    out[cur][t.kind] += t.amount;
  }
  return out;
}

// ---------- Dates ----------
export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const monthKey = (d) => dayKey(d).slice(0, 7);
export const localInputValue = (d = new Date()) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
export function suggestReadingType(date = new Date()) {
  const h = new Date(date).getHours() + new Date(date).getMinutes() / 60;
  if (h >= 2 && h < 5) return 'overnight';
  if (h >= 5 && h < 9) return 'fasting';
  if (h >= 9 && h < 12) return 'post_breakfast';
  if (h >= 12 && h < 14) return 'pre_lunch';
  if (h >= 14 && h < 17.5) return 'post_lunch';
  if (h >= 17.5 && h < 20) return 'pre_dinner';
  if (h >= 20 && h < 22.5) return 'post_dinner';
  return 'bedtime';
}

// ---------- Sync merge ----------
// Records carry `u` (last-updated ms). Deletions are kept as tombstones in `tomb` {id: ms}.
// Settings/profile carry one timestamp `su`; the newer side wins.
export const COLLECTIONS = ['readings', 'txns', 'accounts', 'categories', 'readingTypes'];
export function mergeData(local, remote) {
  if (!remote) return local;
  const out = { ...local };
  const tomb = { ...(remote.tomb || {}) };
  for (const [id, t] of Object.entries(local.tomb || {})) tomb[id] = Math.max(t, tomb[id] || 0);
  const cutoff = Date.now() - 365 * 864e5;
  for (const id of Object.keys(tomb)) if (tomb[id] < cutoff) delete tomb[id];
  for (const c of COLLECTIONS) {
    const map = new Map();
    for (const r of remote[c] || []) map.set(r.id, r);
    for (const r of local[c] || []) {
      const o = map.get(r.id);
      if (!o || (r.u || 0) >= (o.u || 0)) map.set(r.id, r);
    }
    // keep local ordering first, then records only present remotely
    const order = [...(local[c] || []).map((r) => r.id), ...(remote[c] || []).map((r) => r.id)];
    const seen = new Set();
    out[c] = order.filter((id) => !seen.has(id) && seen.add(id))
      .map((id) => map.get(id))
      .filter((r) => !(tomb[r.id] >= (r.u || 0)));
  }
  if ((remote.su || 0) > (local.su || 0)) { out.settings = remote.settings; out.profile = remote.profile; out.su = remote.su; }
  out.tomb = tomb;
  return out;
}
