# Contributing

Use Node.js 24+ and the dependency versions in `package-lock.json`:

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

Keep changes in `src/`, then regenerate and commit `dist/index.ts`. Do not introduce runtime imports of local `.mjs` helpers into the release entrypoint: Node's native module cache can outlive Pi's extension factory reload. `test/loader.host.mjs` exercises actual loader upgrades at the same entrypoint path.

Use only synthetic fixtures. Never commit raw account responses, credentials, account identifiers, machine-specific paths, session logs, local backups, or work-batch artifacts. Add tests for missing/stale/invalid fields and failure behavior along with successful behavior. Preserve the rule that this extension never redeems a reset or submits model work.

## Release checklist

- Confirm ownership/provenance of all contributed code and MIT licensing.
- Run `npm run check` on Windows and at least one Unix platform. CI also targets macOS; configured CI is not evidence of an executed run.
- Verify a normal interactive Pi session, `/codex-quota`, `/codex-resets`, upgrade/reload, and unavailable/stale states. Do not redeem a reset to validate.
- Review `npm pack --dry-run --json --ignore-scripts` and the Git diff for sensitive data and unrelated files.
- Ensure the bundle matches source with `npm run build:check`.
- Confirm repository owner/URL, public visibility, and commit-author metadata before pushing. Set the real repository metadata in `package.json`; do not ship placeholder URLs.
- Update the changelog and tag only after acceptance. Git installation needs the committed bundle, not build hooks.
- Keep `private: true` until npm publication is explicitly approved; remove it only as part of that release decision.

The repository contains no publishing automation, auth configuration or registry tokens. No test requires a logged-in Codex account.
