import test from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { resolveCodexCommand } from '../src/dashboard-query.mjs';
const suffix = ['app-server', '--listen', 'stdio://'];

test('Linux and macOS resolve Codex through PATH without a shell', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(resolveCodexCommand({ platform, env: {}, fileExists: () => false }), { command: 'codex', args: suffix });
  }
});

test('Windows standalone executable on PATH takes precedence', () => {
  const executable = win32.join('C:/Example Tools', 'codex.exe');
  const result = resolveCodexCommand({ platform: 'win32', env: { Path: '"C:/Example Tools";D:/Example' }, fileExists: path => path === executable });
  assert.deepEqual(result, { command: executable, args: suffix });
});

test('Windows custom npm prefix invokes codex.js with Node, never a cmd shim', () => {
  const cli = win32.join('D:/Example Npm', 'node_modules/@openai/codex/bin/codex.js');
  const result = resolveCodexCommand({ platform: 'win32', node: 'node-fixture', env: { PATH: 'D:/Example Npm' }, fileExists: path => path === cli });
  assert.deepEqual(result, { command: 'node-fixture', args: [cli, ...suffix] });
});

test('Windows APPDATA npm install works even when npm prefix is absent from PATH', () => {
  const cli = win32.join('C:/Example AppData', 'npm/node_modules/@openai/codex/bin/codex.js');
  const result = resolveCodexCommand({ platform: 'win32', node: 'node-fixture', env: { APPDATA: 'C:/Example AppData' }, fileExists: path => path === cli });
  assert.deepEqual(result, { command: 'node-fixture', args: [cli, ...suffix] });
});

test('missing Windows executable yields generic spawn failure path without shell fallback', () => {
  assert.deepEqual(resolveCodexCommand({ platform: 'win32', env: {}, fileExists: () => false }), { command: 'codex', args: suffix });
});
