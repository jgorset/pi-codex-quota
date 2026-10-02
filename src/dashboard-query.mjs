import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { normalizeQuota } from './dashboard-model.mjs';

/** Resolve Windows npm/standalone installs without executing shell shim scripts.
 * Unix platforms use the executable on PATH. Injectable for platform fixture tests.
 */
export function resolveCodexCommand({ platform = process.platform, env = process.env, node = process.execPath, fileExists = existsSync } = {}) {
  if (platform === 'win32') {
    const directories = (env.PATH ?? env.Path ?? '').split(';').map(dir => dir.replace(/^"|"$/g, '')).filter(Boolean);
    if (env.APPDATA) directories.push(win32.join(env.APPDATA, 'npm'));
    for (const dir of new Set(directories)) {
      const executable = win32.join(dir, 'codex.exe');
      if (fileExists(executable)) return { command: executable, args: ['app-server', '--listen', 'stdio://'] };
      const cli = win32.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (fileExists(cli)) return { command: node, args: [cli, 'app-server', '--listen', 'stdio://'] };
    }
  }
  return { command: 'codex', args: ['app-server', '--listen', 'stdio://'] };
}

/** Codex app-server client, never a coding-agent session.
 * Only initialize/initialized/account/rateLimits/read can be sent.
 * Dependencies are injectable for offline tests; no response/error is logged.
 * @returns {Promise<ReturnType<typeof normalizeQuota>>}
 */
export function readCodexQuota(signal, { spawnProcess = spawn, now = Date.now, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Quota query cancelled')); return; }
    const { command, args } = resolveCodexCommand();
    let child;
    try { child = spawnProcess(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch { reject(new Error('Codex app-server unavailable')); return; }
    let settled = false;
    let phase = 'initialize';
    let buffer = '';
    let bytes = 0;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      buffer = '';
      child.stdout.removeListener('data', onData);
      // Keep draining until exit; no raw stdout/stderr reaches logs or UI.
      child.stdout.resume();
      try { child.stdin.end(); child.kill(); } catch { /* best-effort own-child cleanup */ }
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error('Quota query cancelled'));
    const timer = setTimeout(() => finish(new Error('Quota query timed out')), timeoutMs);
    const send = message => {
      if (settled) return;
      try { child.stdin.write(JSON.stringify(message) + '\n'); }
      catch { finish(new Error('Codex quota connection closed')); }
    };
    const onMessage = line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || typeof message !== 'object') return;
      const expected = phase === 'initialize' ? 1 : 2;
      if (message.id !== expected) return;
      if (message.error || !Object.hasOwn(message, 'result')) {
        finish(new Error('Codex could not read subscription quota')); return;
      }
      if (phase === 'initialize') {
        phase = 'read';
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/rateLimits/read' });
      } else {
        try { finish(null, normalizeQuota(message.result, now())); }
        catch { finish(new Error('Codex subscription quota unavailable')); }
      }
    };
    const onData = chunk => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) { finish(new Error('Codex quota response too large')); return; }
      buffer += chunk;
      let newline;
      while (!settled && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        onMessage(line);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.resume();
    child.on('error', () => finish(new Error('Codex app-server unavailable')));
    child.on('exit', () => finish(new Error('Codex quota query exited early')));
    child.stdin.on('error', () => finish(new Error('Codex quota connection closed')));
    child.stdout.on('error', () => finish(new Error('Codex quota connection closed')));
    child.stderr.on('error', () => finish(new Error('Codex quota connection closed')));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'pi_codex_quota', title: 'Pi Codex Quota', version: '0.1.0' },
      capabilities: { experimentalApi: false },
    } });
  });
}
