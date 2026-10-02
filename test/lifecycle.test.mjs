import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerQuota } from '../src/index.ts';
import { normalizeQuota, REFRESH_MS, MAX_AGE_MS } from '../src/dashboard-model.mjs';

const NOW = 1790956800000;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/quota.json', import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(read) {
  let now = NOW;
  const events = new Map(), commands = new Map(), timers = new Map();
  const statuses = [], notices = [], selects = [], signals = [];
  const ctx = { mode: 'tui', hasUI: true, ui: {
    setStatus: (key, text) => statuses.push({ key, text }),
    notify: (text, level) => notices.push({ text, level }),
    select: async (title, rows) => { selects.push({ title, rows }); return rows[0]; },
  } };
  const pi = { on: (event, callback) => events.set(event, callback), registerCommand: (name, command) => commands.set(name, command) };
  registerQuota(pi, {
    read: signal => { signals.push(signal); return read ? read(signal) : Promise.resolve(normalizeQuota(fixture, now)); },
    now: () => now,
    interval: (callback, ms) => { const timer = { unref() {} }; timers.set(timer, { callback, ms }); return timer; },
    clear: timer => timers.delete(timer),
  });
  return { events, commands, timers, statuses, notices, selects, signals, ctx,
    setNow: value => { now = value; },
    start: () => events.get('session_start')({}, ctx),
    stop: () => events.get('session_shutdown')({}, ctx),
    command: name => commands.get(name).handler('', ctx),
    runTimer: ms => { for (const timer of timers.values()) if (timer.ms === ms) timer.callback(); },
    last: () => statuses.at(-1)?.text,
  };
}

test('factory has no IO; TUI session starts polling and shutdown is idempotent', async () => {
  const h = harness();
  assert.equal(h.signals.length, 0); assert.equal(h.timers.size, 0);
  h.start(); assert.equal(h.last(), 'Weekly: loading');
  await tick();
  assert.match(h.last(), /Weekly: 72%/);
  assert.equal(h.timers.size, 2);
  h.stop(); h.stop();
  assert.equal(h.timers.size, 0); assert.equal(h.last(), undefined);
});

test('RPC/JSON/print modes neither poll nor open terminal-only screens', async () => {
  for (const mode of ['rpc', 'json', 'print']) {
    const h = harness(); h.ctx.mode = mode; h.ctx.hasUI = mode === 'rpc';
    h.start(); await h.command('codex-quota'); await h.command('codex-resets');
    assert.equal(h.signals.length, 0); assert.equal(h.timers.size, 0); assert.equal(h.selects.length, 0);
  }
});

test('overlapping commands await the same in-flight read before showing details', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  h.start();
  const one = h.command('codex-quota'), two = h.command('codex-resets');
  assert.equal(h.signals.length, 1); assert.equal(h.selects.length, 0);
  resolve(normalizeQuota(fixture, NOW));
  await Promise.all([one, two]);
  assert.equal(h.selects.length, 1);
  assert.match(h.selects[0].rows[0], /redeemed/);
  assert.match(h.notices[0].text, /all times UTC/);
  h.stop();
});

test('failure preserves recent reading only as stale, then hides at retention boundary', async () => {
  let failure = false;
  const h = harness(() => failure ? Promise.reject(new Error('SYNTHETIC_TOKEN')) : Promise.resolve(normalizeQuota(fixture, NOW)));
  h.start(); await tick(); failure = true;
  await h.command('codex-quota');
  assert.match(h.last(), /72%.*\(stale\)$/);
  h.setNow(NOW + MAX_AGE_MS); h.runTimer(15000);
  assert.equal(h.last(), 'Weekly: unavailable');
  await h.command('codex-resets');
  assert.equal(h.selects.length, 0);
  assert.doesNotMatch(JSON.stringify([h.statuses, h.notices]), /SYNTHETIC/);
  h.stop();
});

test('initial failure shows unavailable and later success recovers', async () => {
  let failure = true;
  const h = harness(() => failure ? Promise.reject(new Error('SYNTHETIC')) : Promise.resolve(normalizeQuota(fixture, NOW)));
  h.start(); await tick(); assert.equal(h.last(), 'Weekly: unavailable');
  failure = false; h.runTimer(REFRESH_MS); await tick();
  assert.match(h.last(), /72%/); assert.doesNotMatch(h.last(), /stale/);
  h.stop();
});

test('idle display ticks reevaluate deadlines without additional account reads', async () => {
  const f = structuredClone(fixture); f.rateLimitsByLimitId.codex.primary.resetsAt = NOW / 1000 + 1;
  const h = harness(() => Promise.resolve(normalizeQuota(f, NOW)));
  h.start(); await tick();
  h.setNow(NOW + 1000); h.runTimer(15000);
  assert.match(h.last(), /reset due.*stale/);
  assert.equal(h.signals.length, 1);
  h.stop();
});

test('session replacement aborts old read; late completion cannot overwrite new status', async () => {
  const resolvers = [];
  const h = harness(() => new Promise(resolve => resolvers.push(resolve)));
  h.start(); const oldCommand = h.command('codex-resets');
  h.start();
  assert.equal(h.signals[0].aborted, true);
  const fresh = normalizeQuota(fixture, NOW); fresh.windows[0].remaining = 55;
  resolvers[1](fresh); await tick(); assert.match(h.last(), /55%/);
  resolvers[0](normalizeQuota(fixture, NOW)); await oldCommand;
  assert.match(h.last(), /55%/); assert.equal(h.selects.length, 0);
  h.stop();
});

test('legacy arrays and malformed snapshots cannot escape a fire-and-forget refresh', async () => {
  for (const value of [[{ remaining: 72, minutes: 10080 }], {}, null, { fetchedAt: NOW }, { ...normalizeQuota(fixture, NOW), windows: [null] }]) {
    const h = harness(() => Promise.resolve(value));
    h.start(); await tick();
    assert.equal(h.last(), 'Weekly: unavailable');
    h.runTimer(15000);
    await h.command('codex-resets');
    assert.equal(h.selects.length, 0);
    h.stop();
  }
});

test('invalid refresh retains valid data as stale instead of replacing it', async () => {
  let value = normalizeQuota(fixture, NOW);
  const h = harness(() => Promise.resolve(value));
  h.start(); await tick();
  value = [{ remaining: 72, minutes: 10080 }];
  await h.command('codex-quota');
  assert.match(h.last(), /72%.*stale/);
  h.stop();
});

test('shutdown abort and late completion do not write to a disposed context', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  h.start(); h.stop(); const count = h.statuses.length;
  assert.equal(h.signals[0].aborted, true);
  resolve(normalizeQuota(fixture, NOW)); await tick();
  assert.equal(h.statuses.length, count);
});
