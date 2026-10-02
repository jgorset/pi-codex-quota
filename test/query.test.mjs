import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { readCodexQuota } from '../src/dashboard-query.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/quota.json', import.meta.url), 'utf8'));
const NOW = 1790956800000;

function harness(onWrite = () => {}) {
  const child = new EventEmitter();
  const writes = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    const message = JSON.parse(chunk.toString());
    writes.push(message);
    queueMicrotask(() => onWrite(message, child));
    done();
  } });
  child.killed = 0;
  child.kill = () => { child.killed++; return true; };
  const launch = [];
  const deps = { now: () => NOW, timeoutMs: 1000, spawnProcess: (...args) => { launch.push(args); return child; } };
  const send = message => child.stdout.write(`${JSON.stringify(message)}\n`);
  return { child, deps, writes, launch, send };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('transport sends exactly read-only handshake/read and returns redacted normalized snapshot', async () => {
  const h = harness((message, child) => {
    if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
    if (message.id === 2) child.stdout.write(JSON.stringify({ id: 2, result: fixture }) + '\n');
  });
  const result = await readCodexQuota(undefined, h.deps);
  assert.deepEqual(h.writes.map(m => m.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.ok(h.launch[0][1].includes('app-server'));
  assert.equal(h.launch[0][2].windowsHide, true);
  assert.equal(result.windows[0].remaining, 72);
  assert.equal(result.fetchedAt, NOW);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|accountId|accessToken/);
  assert.equal(h.child.killed, 1);
  assert.equal(h.child.stdin.writableEnded, true);
});

test('fragmented JSON, notifications, malformed lines and duplicate init cannot duplicate read', async () => {
  const h = harness();
  const pending = readCodexQuota(undefined, h.deps);
  h.child.stdout.write('noise\nnull\n{"method":"notification","params":{"secret":"SYNTHETIC"}}\n{"id":1,');
  h.child.stdout.write('"result":{}}\n');
  h.send({ id: 1, result: {} });
  h.send({ id: 99, error: { message: 'SYNTHETIC_SECRET' } });
  h.send({ id: 2, result: fixture });
  const result = await pending;
  assert.equal(result.credits.length, 4);
  assert.equal(h.writes.filter(m => m.method === 'account/rateLimits/read').length, 1);
});

test('pre-abort creates no child; midflight abort kills once and ignores late results', async () => {
  const controller = new AbortController(); controller.abort();
  const h = harness();
  await assert.rejects(readCodexQuota(controller.signal, h.deps), /cancelled/);
  assert.equal(h.launch.length, 0);
  const active = new AbortController();
  const pending = readCodexQuota(active.signal, h.deps);
  active.abort();
  await assert.rejects(pending, /cancelled/);
  h.send({ id: 2, result: fixture });
  assert.equal(h.child.killed, 1);
});

test('timeout, spawn errors and early exit surface only generic errors', async () => {
  const h = harness();
  await assert.rejects(readCodexQuota(undefined, { ...h.deps, timeoutMs: 5 }), /timed out/);
  assert.equal(h.child.killed, 1);
  await assert.rejects(readCodexQuota(undefined, { spawnProcess() { throw new Error('SYNTHETIC_TOKEN'); } }), error => {
    assert.equal(error.message, 'Codex app-server unavailable'); return true;
  });
  for (const event of ['error', 'exit']) {
    const h2 = harness();
    const pending = readCodexQuota(undefined, h2.deps);
    h2.child.emit(event, new Error('SYNTHETIC_ACCOUNT_ID'));
    await assert.rejects(pending, error => !error.message.includes('SYNTHETIC'));
    assert.equal(h2.child.killed, 1);
  }
});

test('RPC errors/empty result and pipe errors redact secrets', async () => {
  for (const response of [{ id: 2, error: { message: 'SYNTHETIC_SECRET' } }, { id: 2, result: {} }, { id: 2 }]) {
    const h = harness();
    const pending = readCodexQuota(undefined, h.deps);
    h.send({ id: 1, result: {} }); h.send(response);
    await assert.rejects(pending, error => !error.message.includes('SYNTHETIC'));
    assert.equal(h.child.killed, 1);
  }
  for (const stream of ['stdin', 'stdout', 'stderr']) {
    const h = harness();
    const pending = readCodexQuota(undefined, h.deps);
    h.child[stream].emit('error', new Error('SYNTHETIC_SECRET'));
    await assert.rejects(pending, /connection closed/);
  }
});

test('bounded output prevents an unbounded line buffer', async () => {
  const h = harness();
  const pending = readCodexQuota(undefined, h.deps);
  h.child.stdout.write('x'.repeat(1024 * 1024 + 1));
  await assert.rejects(pending, /response too large/);
  assert.equal(h.child.killed, 1);
});

test('initialization rejection does not issue the account read', async () => {
  const h = harness();
  const pending = readCodexQuota(undefined, h.deps);
  h.send({ id: 1, error: { message: 'SYNTHETIC_SECRET' } });
  await assert.rejects(pending, /could not read/);
  await tick();
  assert.equal(h.writes.length, 1);
});
