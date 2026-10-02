import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readCodexQuota } from './dashboard-query.mjs';
import { formatCompact, formatDetails, normalizeQuota, REFRESH_MS } from './dashboard-model.mjs';

type Snapshot = ReturnType<typeof normalizeQuota>;
type Dependencies = {
  read: (signal: AbortSignal) => Promise<unknown>;
  now: () => number;
  interval: typeof setInterval;
  clear: typeof clearInterval;
};
const STATUS_KEY = 'codex-quota';

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Partial<Snapshot>;
  return Number.isFinite(data.fetchedAt) && Array.isArray(data.windows) && Array.isArray(data.credits)
    && typeof data.bankKnown === 'boolean' && typeof data.creditsKnown === 'boolean'
    && typeof data.omittedCredits === 'number' && Number.isSafeInteger(data.omittedCredits) && data.omittedCredits >= 0
    && data.windows.every(window => window && typeof window === 'object' && !Array.isArray(window))
    && data.credits.every(credit => credit && typeof credit === 'object' && !Array.isArray(credit));
}

/** Exported seam for offline lifecycle tests; factory performs no IO. */
export function registerQuota(pi: ExtensionAPI, dependencies: Partial<Dependencies> = {}) {
  const deps: Dependencies = { read: readCodexQuota, now: Date.now, interval: setInterval, clear: clearInterval, ...dependencies };
  let timers: ReturnType<typeof setInterval>[] = [];
  let generation = 0;
  let context: ExtensionContext | undefined;
  let snapshot: Snapshot | undefined;
  let failed = false;
  let flight: { controller: AbortController; promise: Promise<void> } | undefined;

  function publish() {
    let text = 'Weekly: loading';
    try {
      if (snapshot || failed) text = formatCompact(snapshot, { now: deps.now(), failed });
    } catch {
      // A rendering/data-contract fault must never reject an unawaited timer refresh.
      snapshot = undefined;
      failed = true;
      text = 'Weekly: unavailable';
    }
    context?.ui.setStatus(STATUS_KEY, text);
  }

  function stop() {
    generation++;
    for (const timer of timers) deps.clear(timer);
    timers = [];
    flight?.controller.abort();
    flight = undefined;
    context?.ui.setStatus(STATUS_KEY, undefined);
    context = undefined;
    snapshot = undefined;
    failed = false;
  }

  function refresh(): Promise<void> {
    if (flight) return flight.promise;
    if (!context) return Promise.resolve();
    const currentGeneration = generation;
    const request = { controller: new AbortController(), promise: Promise.resolve() };
    flight = request;
    publish();
    request.promise = (async () => {
      try {
        const next = await deps.read(request.controller.signal);
        if (currentGeneration !== generation || request.controller.signal.aborted) return;
        if (!isSnapshot(next)) throw new Error('Quota snapshot contract unavailable');
        // Validate rendering before replacing a previously valid cached observation.
        formatCompact(next, { now: deps.now() });
        formatDetails(next, { now: deps.now() });
        snapshot = next;
        failed = false;
      } catch {
        if (currentGeneration !== generation || request.controller.signal.aborted) return;
        failed = true;
      } finally {
        if (flight === request) flight = undefined;
      }
      if (currentGeneration === generation) publish();
    })();
    return request.promise;
  }

  pi.on('session_start', (_event, ctx) => {
    stop();
    if (ctx.mode !== 'tui') return;
    context = ctx;
    void refresh();
    const refreshTimer = deps.interval(() => { void refresh(); }, REFRESH_MS);
    // Reevaluate expiry/staleness while idle, without polling the account API more often.
    const displayTimer = deps.interval(publish, 15000);
    timers = [refreshTimer, displayTimer];
    for (const timer of timers) timer.unref?.();
  });
  pi.on('session_shutdown', stop);

  pi.registerCommand('codex-quota', {
    description: 'Refresh Codex weekly quota and usage pacing',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        if (ctx.hasUI) ctx.ui.notify('Codex quota dashboard is available in TUI mode.', 'info');
        return;
      }
      await refresh();
    },
  });
  pi.registerCommand('codex-resets', {
    description: 'Show Codex reset credits ordered by expiry (UTC)',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        if (ctx.hasUI) ctx.ui.notify('Codex reset dashboard is available in TUI mode.', 'info');
        return;
      }
      const currentGeneration = generation;
      await refresh();
      if (currentGeneration !== generation || !context) return;
      const details = formatDetails(snapshot, { now: deps.now(), failed });
      ctx.ui.notify(details.summary, failed ? 'warning' : 'info');
      if (details.rows.length) {
        // Built-in select owns scrolling, keyboard behavior, theming and width handling.
        const selected = await ctx.ui.select('Reset credits — expiry order; UTC; Esc to close', details.rows);
        if (selected && currentGeneration === generation) ctx.ui.notify(selected, 'info');
      }
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerQuota(pi);
}
