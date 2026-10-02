/** Pure, privacy-preserving quota model. No raw account data survives normalization. */
export const REFRESH_MS = 5 * 60 * 1000;
export const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_CREDITS = 200;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Protocol timestamps are Unix seconds; offset-bearing RFC3339 is also accepted.
 * Reject local/ambiguous dates, millisecond epochs, and values outside 1970–9999.
 */
export function timestamp(value) {
  if (Number.isSafeInteger(value) && value >= 0 && value <= 253402300799) return value * 1000;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  const [, y, m, d, h, min, sec] = parts.map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > days || h > 23 || min > 59 || sec > 59) return null;
  const ms = Date.parse(value);
  return finite(ms) && ms >= 0 && ms <= 253402300799999 ? ms : null;
}

/** Accept ONLY returned primary/secondary windows; never manufacture a 5h window. */
export function normalizeQuota(result, fetchedAt = Date.now()) {
  if (!record(result) || !finite(fetchedAt)) throw new Error('Quota response unavailable');
  const limits = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
  const windows = [];
  for (const slot of ['primary', 'secondary']) {
    const raw = limits?.[slot];
    if (!record(raw)) continue;
    const remaining = finite(raw.usedPercent) ? Math.round(Math.max(0, Math.min(100, 100 - raw.usedPercent))) : null;
    const minutes = Number.isSafeInteger(raw.windowDurationMins) && raw.windowDurationMins > 0 ? raw.windowDurationMins : null;
    const resetsAt = timestamp(raw.resetsAt);
    if (remaining !== null || minutes !== null || resetsAt !== null) windows.push({ slot, remaining, minutes, resetsAt });
  }
  const bank = result.rateLimitResetCredits ?? limits?.rateLimitResetCredits;
  const availableCount = Number.isSafeInteger(bank?.availableCount) && bank.availableCount >= 0 ? bank.availableCount : null;
  const creditsKnown = Array.isArray(bank?.credits);
  const bankKnown = record(bank) && (availableCount !== null || creditsKnown);
  const source = creditsKnown ? bank.credits : [];
  const credits = source.map(raw => ({
    // Do not copy IDs, title/free text, account fields, URLs, or unknown enum strings.
    resetType: ['codexRateLimits', 'weekly', 'daily', 'primary', 'secondary', 'five_hour'].includes(raw?.resetType) ? raw.resetType : 'unknown',
    status: ['available', 'redeemed', 'expired', 'used', 'revoked'].includes(raw?.status) ? raw.status : 'unknown',
    grantedAt: timestamp(raw?.grantedAt),
    expiresAt: timestamp(raw?.expiresAt),
  })).sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity)).slice(0, MAX_CREDITS);
  if (!windows.length && !bankKnown) throw new Error('Quota response unavailable');
  return { fetchedAt, windows, bankKnown, availableCount, creditsKnown, credits, omittedCredits: Math.max(0, source.length - MAX_CREDITS) };
}

export function creditState(credit, now) {
  if (credit.status !== 'available') return credit.status;
  if (credit.expiresAt !== null && credit.expiresAt <= now) return 'expired';
  if (credit.grantedAt !== null && credit.grantedAt > now) return 'not yet granted';
  if (credit.expiresAt === null) return 'expiry unknown';
  return 'available';
}

export function durationLabel(minutes, slot = 'window') {
  if (minutes === 10080) return 'weekly';
  if (minutes === null) return slot;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** Absolute UTC in both views: independent of host locale, DST and timezone. */
export function dateText(ms, compact = false) {
  if (ms === null) return '?';
  const iso = new Date(ms).toISOString();
  return compact ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : iso;
}

export function freshness(snapshot, now, failed = false) {
  if (!record(snapshot) || !finite(snapshot.fetchedAt) || !finite(now)
    || !Array.isArray(snapshot.windows) || !snapshot.windows.every(record)
    || !Array.isArray(snapshot.credits) || !snapshot.credits.every(record)) return 'unavailable';
  const age = now - snapshot.fetchedAt;
  if (age < 0 || age >= MAX_AGE_MS) return 'unavailable';
  const resetPassed = snapshot.windows.some(w => w.resetsAt !== null && w.resetsAt <= now);
  return failed || age >= REFRESH_MS || resetPassed ? 'stale' : 'fresh';
}

/** Relative countdown, always based on the returned reset instant, never local time. */
export function timeLeft(resetsAt, now) {
  if (!finite(resetsAt)) return '?';
  const ms = resetsAt - now;
  if (ms <= 0) return 'reset due';
  if (ms < 60000) return '<1m';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** Compare quota remaining to time remaining in the actual returned window.
 * Five percentage points either side is on pace. Unknown/stale data has no rating.
 */
export function paceIndicator(window, now, fresh = true) {
  if (!fresh || !finite(window.remaining) || !finite(window.resetsAt)
    || !finite(window.minutes) || window.minutes <= 0) return '?';
  const timePercent = (window.resetsAt - now) / (window.minutes * 60000) * 100;
  if (timePercent <= 0 || timePercent > 100) return '?';
  const headroom = window.remaining - timePercent;
  if (headroom > 5 + 1e-9) return '↑';
  if (headroom < -5 - 1e-9) return '↓';
  return '→';
}

export function formatCompact(snapshot, { now = Date.now(), failed = false } = {}) {
  const state = freshness(snapshot, now, failed);
  if (state === 'unavailable') return 'Weekly: unavailable';
  // Only the explicitly returned weekly window belongs in this compact view.
  const weekly = snapshot.windows.filter(w => w.minutes === 10080);
  const window = weekly.sort((a, b) => (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity))[0];
  if (!window) return `Weekly: unavailable${state === 'stale' ? ' (stale)' : ''}`;
  const percent = window.remaining === null ? '?' : `${window.remaining}%`;
  const countdown = timeLeft(window.resetsAt, now);
  const suffix = countdown === 'reset due' ? '' : ' left';
  return `Weekly: ${percent} / ${countdown}${suffix} ${paceIndicator(window, now, state === 'fresh')}${state === 'stale' ? ' (stale)' : ''}`;
}

export function formatDetails(snapshot, { now = Date.now(), failed = false } = {}) {
  const state = freshness(snapshot, now, failed);
  if (state === 'unavailable') return { summary: 'Codex quota/reset data unavailable. Retry /codex-resets.', rows: [] };
  const summary = [
    `Codex quota/reset credits — ${state}; all times UTC`,
    `Observed ${dateText(snapshot.fetchedAt)}; now ${dateText(now)}`,
    ...snapshot.windows.map(w => `${durationLabel(w.minutes, w.slot)}: ${w.remaining === null ? '?' : `${w.remaining}%`} left; reset ${dateText(w.resetsAt)}${w.resetsAt !== null && w.resetsAt <= now ? ' (due; refresh required)' : ''}`),
    `Server-reported available: ${snapshot.availableCount ?? '?'}; listed credits: ${snapshot.creditsKnown ? snapshot.credits.length : '?'}.`,
    'Footer pace: ↑ ahead (more quota headroom), → on track (±5 percentage points), ↓ behind (faster consumption), ? unknown/stale.',
    'Pace compares quota remaining with time remaining in the returned weekly window; it is a linear budget guide, not a forecast.',
    'Credits ordered by expiry (unknown last). Server counts may lag deadlines or differ from the returned list.',
    'Titles/IDs are omitted for privacy.',
    ...(snapshot.omittedCredits ? [`${snapshot.omittedCredits} additional credits omitted (safety cap).`] : []),
  ].join('\n');
  const rows = snapshot.credits.map((c, i) => `${i + 1}. expires ${dateText(c.expiresAt)} | ${c.resetType} | ${creditState(c, now)} (reported ${c.status}) | granted ${dateText(c.grantedAt)}`);
  if (!rows.length) rows.push(snapshot.creditsKnown ? 'No reset credits returned.' : 'Reset-credit list unavailable (not the same as zero).');
  return { summary, rows };
}
