import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { normalizeQuota, timestamp, creditState, formatCompact, formatDetails, freshness, dateText, timeLeft, paceIndicator, REFRESH_MS, MAX_AGE_MS } from '../src/dashboard-model.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/quota.json', import.meta.url), 'utf8'));
const NOW = 1790956800000; // 2026-10-02 16:00 UTC (synthetic observation clock)
const snapshot = () => normalizeQuota(fixture(), NOW);

test('Codex-specific limits win; weekly percentage retained without invented 5h', () => {
  const s = snapshot();
  assert.deepEqual(s.windows, [{ slot: 'primary', remaining: 72, minutes: 10080, resetsAt: 1791047315000 }]);
  const text = formatCompact(s, { now: NOW });
  assert.equal(text, 'Weekly: 72% / 1d 1h left ↑');
  assert.doesNotMatch(text, /5h|bank|exp |10-03/);
});

test('legacy limits and actual secondary durations are preserved', () => {
  const s = normalizeQuota({ rateLimits: { primary: { usedPercent: 9.7, windowDurationMins: 300 }, secondary: { usedPercent: 90, windowDurationMins: 90 } } }, NOW);
  assert.match(formatDetails(s, { now: NOW }).summary, /5h: 90% left/);
  assert.match(formatDetails(s, { now: NOW }).summary, /90m: 10% left/);
  assert.equal(formatCompact(s, { now: NOW }), 'Weekly: unavailable');
});

test('weekly window may be secondary and missing usage does not erase reset', () => {
  const s = normalizeQuota({ rateLimits: { primary: { usedPercent: 30 }, secondary: { windowDurationMins: 10080, resetsAt: 1791047315 } } }, NOW);
  assert.equal(formatCompact(s, { now: NOW }), 'Weekly: ? / 1d 1h left ?');
  assert.match(formatDetails(s, { now: NOW }).summary, /weekly: \? left/);
});

test('percentages clamp; invalid numeric strings, NaN and Infinity are not coerced', () => {
  const s = normalizeQuota({ rateLimits: { primary: { usedPercent: -10 }, secondary: { usedPercent: 150 } } }, NOW);
  assert.deepEqual(s.windows.map(w => w.remaining), [100, 0]);
  for (const value of ['20', NaN, Infinity, null, true]) {
    assert.throws(() => normalizeQuota({ rateLimits: { primary: { usedPercent: value } } }, NOW), /unavailable/);
  }
});

test('empty/malformed responses fail safely rather than implying zero availability', () => {
  for (const value of [null, [], {}, { rateLimits: {} }, { rateLimitResetCredits: {} }, { rateLimitResetCredits: { credits: {} } }]) {
    assert.throws(() => normalizeQuota(value, NOW), /unavailable/);
  }
  const s = normalizeQuota({ rateLimitResetCredits: { availableCount: 0, credits: [] } }, NOW);
  assert.equal(formatCompact(s, { now: NOW }), 'Weekly: unavailable');
  assert.deepEqual(formatDetails(s, { now: NOW }).rows, ['No reset credits returned.']);
});

test('missing bank, absent list, unknown counts and nested bank are distinct', () => {
  const f = fixture(); delete f.rateLimitResetCredits;
  assert.equal(normalizeQuota(f, NOW).bankKnown, false);
  f.rateLimitResetCredits = { availableCount: 4 };
  assert.equal(normalizeQuota(f, NOW).availableCount, 4);
  assert.equal(normalizeQuota(f, NOW).creditsKnown, false);
  f.rateLimitResetCredits = { availableCount: -1, credits: [] };
  assert.equal(normalizeQuota(f, NOW).availableCount, null);
  f.rateLimitsByLimitId.codex.rateLimitResetCredits = { availableCount: 0, credits: [] };
  delete f.rateLimitResetCredits;
  assert.equal(normalizeQuota(f, NOW).availableCount, 0);
});

test('credit details sorted ascending by expiry; unknown timestamps last', () => {
  const f = fixture(); f.rateLimitResetCredits.credits.unshift({ status: 'available' });
  const s = normalizeQuota(f, NOW);
  assert.deepEqual(s.credits.map(c => c.expiresAt), [1791000000000, 1791100000000, 1791200000000, 1791400000000, null]);
  const rows = formatDetails(s, { now: NOW }).rows;
  assert.match(rows[0], /redeemed/);
  assert.match(rows[4], /expires \?.*expiry unknown/);
});

test('exact expiry boundary is excluded, never redeemable at expiresAt', () => {
  const c = { status: 'available', grantedAt: NOW - 1000, expiresAt: NOW };
  assert.equal(creditState(c, NOW - 1), 'available');
  assert.equal(creditState(c, NOW), 'expired');
  assert.equal(creditState(c, NOW + 1), 'expired');
  assert.equal(creditState({ ...c, status: 'redeemed' }, NOW - 1), 'redeemed');
  assert.equal(creditState({ ...c, grantedAt: NOW + 1, expiresAt: NOW + 2000 }, NOW), 'not yet granted');
  assert.equal(creditState({ ...c, expiresAt: null }, NOW), 'expiry unknown');
});

test('past/invalid/unknown credits never appear as available deadlines', () => {
  const s = normalizeQuota({ rateLimitResetCredits: { availableCount: 4, credits: [
    { status: 'available', expiresAt: NOW / 1000 },
    { status: 'available', expiresAt: 'invalid' },
    { status: 'future-status', expiresAt: NOW / 1000 + 100 },
    { status: 'available', expiresAt: NOW / 1000 + 100, grantedAt: NOW / 1000 + 1 },
  ] } }, NOW);
  assert.equal(s.credits.filter(c => creditState(c, NOW) === 'available').length, 0);
  assert.doesNotMatch(formatCompact(s, { now: NOW }), / exp /);
});

test('count mismatch and missing fields remain visible instead of fabricated availability', () => {
  const f = fixture(); f.rateLimitResetCredits.availableCount = 0;
  const s = normalizeQuota(f, NOW);
  assert.doesNotMatch(formatCompact(s, { now: NOW }), /bank|exp /);
  assert.match(formatDetails(s, { now: NOW }).summary, /Server-reported available: 0/);
});

test('Unix seconds and offset RFC3339 normalize to the same instant', () => {
  assert.equal(timestamp(1791047315), 1791047315000);
  assert.equal(timestamp('2026-10-03T17:08:35Z'), 1791047315000);
  assert.equal(timestamp('2026-10-03T13:08:35-04:00'), 1791047315000);
  assert.equal(timestamp('2026-10-03T22:38:35+05:30'), 1791047315000);
  assert.equal(timestamp(0), 0);
  assert.equal(timestamp('2028-02-29T12:00:00Z'), Date.parse('2028-02-29T12:00:00Z'));
});

test('ambiguous local dates, rollover dates, bad offsets and millisecond epochs are rejected', () => {
  for (const value of ['2026-10-03T15:48:35', '2026-02-29T12:00:00Z', '2026-13-01T12:00:00Z', '2026-10-03T24:00:00Z', '2026-10-03T15:48:35+24:00', '1791047315', 1791047315000, -1, NaN, Infinity, 1.2, {}, null]) {
    assert.equal(timestamp(value), null, JSON.stringify(value));
  }
});

test('UTC display stable across timezone and DST changes', () => {
  const moduleUrl = new URL('../src/dashboard-model.mjs', import.meta.url).href;
  const expression = `import {timestamp,dateText} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify([dateText(timestamp('2026-11-01T01:30:00-04:00')),dateText(timestamp('2026-11-01T01:30:00-05:00')),dateText(1791047315000,true)]));`;
  const outputs = ['UTC', 'America/New_York', 'Asia/Kolkata'].map(TZ => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', expression], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  });
  assert.equal(new Set(outputs).size, 1);
  assert.match(outputs[0], /05:30:00.000Z.*06:30:00.000Z/);
  assert.equal(dateText(1791047315000, true), '10-03 17:08Z');
});

test('failure and age mark stale; exact 30-minute retention/clock rollback hides old data', () => {
  const s = snapshot();
  assert.equal(freshness(s, NOW), 'fresh');
  assert.equal(freshness(s, NOW, true), 'stale');
  assert.equal(freshness(s, NOW + REFRESH_MS - 1), 'fresh');
  assert.equal(freshness(s, NOW + REFRESH_MS), 'stale');
  assert.equal(freshness(s, NOW + MAX_AGE_MS - 1), 'stale');
  for (const now of [NOW - 1, NOW + MAX_AGE_MS, NOW + MAX_AGE_MS + 1]) {
    assert.equal(formatCompact(s, { now }), 'Weekly: unavailable');
    assert.deepEqual(formatDetails(s, { now }).rows, []);
  }
  assert.equal(formatCompact(undefined), 'Weekly: unavailable');
  assert.match(formatCompact(s, { now: NOW, failed: true }), /\(stale\)$/);
});

test('reset due is stale without inventing next week by adding seven days', () => {
  const s = snapshot(); s.windows[0].resetsAt = NOW + 100;
  assert.equal(freshness(s, NOW + 99), 'fresh');
  assert.equal(freshness(s, NOW + 100), 'stale');
  assert.match(formatCompact(s, { now: NOW + 100 }), /reset due.*\(stale\)$/);
});

test('redaction excludes account IDs, tokens, titles, arbitrary enums and control sequences', () => {
  const f = fixture();
  f.rateLimitResetCredits.credits.push({ resetType: 'SYNTHETIC_TYPE_SECRET', status: '\u001b]52;c;SECRET\u0007', title: 'SYNTHETIC_TITLE_SECRET' });
  const s = normalizeQuota(f, NOW);
  const output = JSON.stringify([s, formatCompact(s, { now: NOW }), formatDetails(s, { now: NOW })]);
  assert.doesNotMatch(output, /SYNTHETIC|SECRET|accountId|accessToken|title":|\\u001b|\\u0007/);
});

test('large credit lists keep earliest 200 and explicitly report omitted credits', () => {
  const credits = Array.from({ length: 205 }, (_, i) => ({ status: 'available', expiresAt: NOW / 1000 + 205 - i }));
  const s = normalizeQuota({ rateLimitResetCredits: { availableCount: 205, credits } }, NOW);
  assert.equal(s.credits.length, 200);
  assert.equal(s.credits[0].expiresAt, NOW + 1000);
  assert.equal(s.omittedCredits, 5);
  assert.match(formatDetails(s, { now: NOW }).summary, /5 additional credits omitted/);
});
