# pi-codex-quota

Codex quota, reset countdown, and usage pacing for [Pi](https://github.com/earendil-works/pi).

```text
Weekly: 20% / 3d 12h left ↓
```

See how much weekly quota remains, when it resets, and whether consumption is ahead of or behind a simple weekly budget. Keep reset-credit details one command away instead of crowding the footer.

## Install

Requirements:

- Node.js 24 or newer.
- Pi with the current extension API (developed and tested against `@earendil-works/pi-coding-agent` 1.0.0).
- The official [Codex CLI](https://github.com/openai/codex), installed and already signed in to the account whose quota you want to display. Confirm `codex --version` works in your terminal.

This is an unpublished release candidate. From a local checkout:

```sh
pi install ./pi-codex-quota
```

Or try it for one Pi invocation:

```sh
pi -e ./pi-codex-quota/dist/index.ts
```

Pi loads the committed bundle, so end users do not need to build the project or install its development dependencies. After installing or upgrading, run `/reload` in Pi or restart Pi.

Once a public repository is chosen, it can also be installed using Pi's `git:` package syntax. There is no published npm release yet; do not assume the provisional package name is available indefinitely.

**Upgrading from a manually installed quota extension:** disable or move the old extension outside Pi's extension-discovery directory first. Do not load two implementations owning the `codex-quota` status and commands. Keep a backup until the upgrade is verified.

## Footer and pace

`20%` means **quota remaining**, not used. The countdown uses the reset timestamp actually returned by Codex; it does not predict a new weekly reset after the old timestamp passes.

| Indicator | Meaning |
| --- | --- |
| `↑` | Ahead of budget: more quota headroom than the remaining time would suggest |
| `→` | On track: within ±5 percentage points of a linear weekly budget |
| `↓` | Behind budget: consuming quota faster than that budget |
| `?` | Insufficient, stale, or inconsistent data; no pace rating |

For example, with half the week remaining, 20% quota remaining is behind budget, 50% is on track, and 80% is ahead. The indicator is a **budget guide, not a forecast**; it does not measure your workload or predict provider policy.

The footer refreshes the account reading every five minutes. Countdown and freshness are recalculated locally every 15 seconds. `/codex-quota` requests an immediate refresh. A failed refresh marks recent data stale; readings at least 30 minutes old, or observed after the current clock time, are hidden.

A weekly window must actually be returned with a 10080-minute duration. Missing windows/fields are not interpreted as zero or synthesized as a 5-hour limit. Enterprise/monthly-specific display is not supported in this release.

## Commands

| Command | Purpose |
| --- | --- |
| `/codex-quota` | Refresh weekly quota, countdown, and pace |
| `/codex-resets` | Show quota windows and reset credits ordered by expiry |

The detail command uses Pi's built-in selection UI. Select a credit to show the full row; Esc closes the list. It includes expiry, reset type, reported/effective status, and grant time. Absolute timestamps are explicitly UTC. Unknown expiry sorts last. IDs and arbitrary titles are omitted.

## Works with the standard footer and pi-vitals

The extension uses Pi's supported `ctx.ui.setStatus()` API. It does **not** replace the footer, editor, theme, or any other extension's UI. The standard footer can display the status without another package.

For [pi-vitals](https://www.npmjs.com/package/pi-vitals), use its documented `ext_status` segment. For example, merge this into your existing footer layout:

```json
{
  "rightSegments": ["cost", "separator", "ext_status"]
}
```

Preserve your other segments and settings. `ext_status` displays **all** extension statuses, not just quota. A locally customized dedicated `codex_quota` segment can also read the `codex-quota` status key, but no custom segment or installed-package patch is required or shipped here.

Narrow terminals may truncate a long footer. The full details remain available through the commands. Polling and terminal-only dialogs are disabled outside TUI mode.

## Account access and privacy

The extension invokes the installed Codex CLI's app-server and requests `account/rateLimits/read`. It does not redeem resets, change account settings, invoke a coding agent, or send a model prompt. Codex manages its own existing authentication; the extension does not open or export credential files.

Only allowlisted quota/reset fields are retained in memory. Account/credit IDs, tokens, titles, raw error messages, and unknown enum text are not displayed or logged. There is no telemetry or on-disk account cache. Errors are generic. Each query has a 20-second timeout and 1 MiB output bound; detail lists retain at most the 200 earliest credits with an explicit truncation notice.

This is an unofficial integration with the Codex app-server protocol, which may change. Subscription/account policies can affect which windows and reset-credit fields are returned. Missing reset-credit data is not the same as zero credits.

## Troubleshooting

**`Weekly: unavailable`:** verify that Codex is installed and signed in, then run `/codex-quota`. An account may not return a supported weekly window. Avoid posting raw app-server responses when reporting problems.

**Windows:** npm installations in a PATH prefix or the normal APPDATA npm directory, and `codex.exe` on PATH, are recognized without running shell shim scripts. Nonstandard standalone installations must expose `codex.exe` on PATH.

**Status missing with a custom footer:** enable that footer's extension-status passthrough. For pi-vitals this is `ext_status`.

**Duplicate command/status:** disable the older manual extension or duplicate package declaration. Backups must live outside extension-discovery directories.

**Reload behavior:** the shipped extension is one generated `.ts` entrypoint with only Node built-in imports. This avoids stale native-ESM helper modules across Pi reloads. Same-process upgrades and bundle edits are regression-tested through Pi's actual loader. If developing directly against `src/`, restart Pi after changing native `.mjs` helpers; the supported release entrypoint is `dist/index.ts`.

## Development

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

`npm run check` runs the strict entrypoint typecheck, offline fixture tests, reproducible-bundle check, Pi-loader/UI tests, and package-content checks. Tests never query an account or launch Codex: protocol/process responses are stubbed. The JavaScript helpers are runtime-tested; `checkJs` is not enabled.

`dist/index.ts` is intentionally committed so Git/local installs work without build hooks. It contains generated JavaScript-compatible TypeScript, bundled by esbuild, and no local runtime dependencies. Do not edit it by hand. CI is configured for Windows, Linux, and macOS; see [CONTRIBUTING.md](CONTRIBUTING.md) for the release checklist.

The package currently has `private: true` to prevent accidental npm publication while the public destination is being decided. This does not prevent local or Git installation through Pi.

## License

[MIT](LICENSE). Not affiliated with OpenAI or the Pi maintainers.
