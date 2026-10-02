import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import childProcess from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeQuota, formatDetails } from '../src/dashboard-model.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const hostEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
const { loadExtensions, clearExtensionCache } = await import(new URL('./core/extensions/loader.js', hostEntry).href);
const hostRequire = createRequire(hostEntry);
const { Text, SelectList, visibleWidth } = await import(pathToFileURL(hostRequire.resolve('@earendil-works/pi-tui')).href);
const bundle = readFileSync(join(root, 'dist/index.ts'), 'utf8');

async function load(path, cwd = root) {
  const result = await loadExtensions([path], cwd);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  return result.extensions[0];
}
async function emit(extension, event, ctx) {
  for (const handler of extension.handlers.get(event) || []) await handler({}, ctx);
}

test('packaged single-file extension loads through Pi and registers expected commands', async () => {
  const extension = await load(join(root, 'dist/index.ts'));
  assert.deepEqual([...extension.commands.keys()], ['codex-quota', 'codex-resets']);
  assert.deepEqual([...extension.handlers.keys()], ['session_start', 'session_shutdown']);
  assert.equal(extension.tools.size, 0);
  const imports = [...bundle.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every(specifier => specifier.startsWith('node:')), 'Bundle must have no local or npm runtime imports');
});

test('built-in detail components fit narrow/wide terminals and preserve selectable rows', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/quota.json', import.meta.url), 'utf8'));
  const now = 1790956800000;
  const details = formatDetails(normalizeQuota(fixture, now), { now });
  const identity = text => text;
  const theme = { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity };
  const list = new SelectList(details.rows.map(row => ({ value: row, label: row })), 3, theme);
  for (const width of [20, 40, 80, 120]) {
    for (const line of list.render(width)) assert.ok(visibleWidth(line) <= width);
    for (const line of new Text(details.summary, 0, 0).render(width)) assert.ok(visibleWidth(line) <= width);
  }
  list.setSelectedIndex(3);
  assert.equal(list.getSelectedItem().value, details.rows[3]);
});

test('actual Pi loader upgrades from a cached legacy dependency and reloads bundle edits', async () => {
  mkdirSync(join(root, '.validation'), { recursive: true });
  const dir = mkdtempSync(join(root, '.validation', 'reload-'));
  const entry = join(dir, 'index.ts');
  writeFileSync(join(dir, 'query.mjs'), 'export async function read(){return [{remaining:20,minutes:10080}];}');
  writeFileSync(entry, `import {read} from './query.mjs'; export default function(pi){pi.registerCommand('legacy',{description:'Fixture',handler:async()=>read()});}`);
  const old = await load(entry, dir);
  assert.deepEqual(await old.commands.get('legacy').handler('', {}), [{ remaining: 20, minutes: 10080 }]);
  // Stale native ESM helper remains in cache; the new bundle must not use it.
  writeFileSync(join(dir, 'query.mjs'), "throw new Error('Updated legacy helper must not be imported');");
  writeFileSync(entry, bundle);
  clearExtensionCache();

  let status;
  const ctx = { mode: 'tui', hasUI: true, ui: { setStatus: (_key, text) => { status = text; }, notify() {}, async select() {} } };
  const methods = [];
  let failing = false;
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const message = JSON.parse(chunk.toString());
      methods.push(message.method);
      queueMicrotask(() => {
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write(JSON.stringify({ id: 2, result: failing ? {} : { rateLimits: { primary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 302400 } } } }) + '\n');
      });
      done();
    } });
    child.kill = () => true;
    return child;
  };
  syncBuiltinESMExports();
  let current;
  try {
    current = await load(entry, dir);
    await emit(current, 'session_start', ctx);
    await current.commands.get('codex-quota').handler('', ctx);
    assert.match(status, /^Weekly: 20% \/ .* left ↓$/);
    failing = true;
    await current.commands.get('codex-quota').handler('', ctx);
    assert.match(status, /Weekly: 20%.*\? \(stale\)$/);
    await emit(current, 'session_shutdown', ctx);
    failing = false;
    // An implementation update at exactly the same entrypoint must be reloaded.
    writeFileSync(entry, bundle.replaceAll('Weekly:', 'Updated weekly:'));
    clearExtensionCache();
    current = await load(entry, dir);
    await emit(current, 'session_start', ctx);
    await current.commands.get('codex-quota').handler('', ctx);
    assert.match(status, /^Updated weekly: 20%/);
    assert.ok(methods.every(method => ['initialize', 'initialized', 'account/rateLimits/read'].includes(method)));
  } finally {
    if (current) await emit(current, 'session_shutdown', ctx);
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});
