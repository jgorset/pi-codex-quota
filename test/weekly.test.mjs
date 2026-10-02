import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuota, formatCompact, formatDetails, timeLeft, paceIndicator } from '../src/dashboard-model.mjs';
const NOW = 1790956800000;
const WEEK = 10080 * 60000;
const window = remaining => ({ remaining, minutes: 10080, resetsAt: NOW + WEEK / 2 });

test('requested weekly text has remaining percent, countdown and pace only', () => {
  const s = normalizeQuota({ rateLimits: { primary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: (NOW + WEEK / 2) / 1000 } }, rateLimitResetCredits: { availableCount: 4, credits: [] } }, NOW);
  assert.equal(formatCompact(s, { now: NOW }), 'Weekly: 20% / 3d 12h left ↓');
  assert.doesNotMatch(formatCompact(s, { now: NOW }), /bank|exp|UTC|Monthly/);
  assert.match(formatDetails(s, { now: NOW }).summary, /Server-reported available: 4/);
});

test('pace compares remaining quota against remaining time with inclusive five-point tolerance', () => {
  assert.equal(paceIndicator(window(20), NOW), '↓');
  assert.equal(paceIndicator(window(80), NOW), '↑');
  for (const remaining of [45, 50, 55]) assert.equal(paceIndicator(window(remaining), NOW), '→');
  assert.equal(paceIndicator(window(44.99), NOW), '↓');
  assert.equal(paceIndicator(window(55.01), NOW), '↑');
});

test('stale, unknown and impossible reset windows have no pace claim', () => {
  assert.equal(paceIndicator(window(50), NOW, false), '?');
  for (const patch of [{ remaining: null }, { resetsAt: null }, { resetsAt: NOW }, { resetsAt: NOW + WEEK + 1 }, { minutes: 0 }]) {
    assert.equal(paceIndicator({ ...window(50), ...patch }, NOW), '?');
  }
});

test('countdowns handle day/hour/minute/reset boundaries', () => {
  for (const [ms, expected] of [[WEEK / 2, '3d 12h'], [86400000, '1d 0h'], [3660000, '1h 1m'], [60000, '1m'], [59999, '<1m'], [1, '<1m'], [0, 'reset due'], [-1, 'reset due']]) {
    assert.equal(timeLeft(NOW + ms, NOW), expected);
  }
  assert.equal(timeLeft(null, NOW), '?');
});

test('legacy array and malformed snapshot formatter inputs are safely unavailable', () => {
  for (const value of [[{ remaining: 20 }], {}, { fetchedAt: NOW }, { fetchedAt: NOW, windows: [null], credits: [] }]) {
    assert.equal(formatCompact(value, { now: NOW }), 'Weekly: unavailable');
    assert.deepEqual(formatDetails(value, { now: NOW }).rows, []);
  }
});

test('monthly-only response does not invent a weekly window or claim enterprise support', () => {
  const s = normalizeQuota({ rateLimits: { primary: { usedPercent: 20, windowDurationMins: 43200, resetsAt: (NOW + WEEK) / 1000 } } }, NOW);
  assert.equal(formatCompact(s, { now: NOW }), 'Weekly: unavailable');
});
