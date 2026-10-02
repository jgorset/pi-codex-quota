# pi-codex-quota

Codex quota, reset countdown, and usage pacing for [Pi](https://github.com/earendil-works/pi).

```text
Weekly: 20% / 3d 12h left ↓
```

## Install

Requires **Node 24+**, **Pi 1.0+**, and the [Codex CLI](https://github.com/openai/codex), already signed in.

This is an unpublished release candidate. From the parent of your local checkout:

```sh
pi install ./pi-codex-quota
```

Run `/reload` in Pi. No build needed. Disable any older quota extension first to avoid duplicate commands.

## Using it

The percentage is **quota remaining**. The arrow compares it with the time remaining in the week:

- `↑` Ahead of budget
- `→` On track, within ±5 percentage points
- `↓` Consuming faster than budget
- `?` Not enough fresh data

It's a budget guide, not a forecast. Quota refreshes every five minutes; the countdown updates every 15 seconds.

- **`/codex-quota`** — refresh now.
- **`/codex-resets`** — view reset credits by expiry, with UTC timestamps.

Works with Pi's standard footer. With **pi-vitals**, add its `ext_status` segment to your existing layout, for example:

```json
{ "rightSegments": ["cost", "separator", "ext_status"] }
```

`ext_status` shows all extension statuses. Preserve your other settings.

**Unavailable?** Check that `codex --version` works and Codex is signed in, then refresh. Some accounts don't return a weekly window; enterprise/monthly support isn't included.

The extension uses Codex's existing login. It doesn't read credential files, redeem resets, make model calls, or send telemetry. See [security notes](SECURITY.md).

## Development

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Tests use synthetic data and stubbed account queries. [MIT licensed](LICENSE); not affiliated with OpenAI or Pi.
