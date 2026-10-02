# Security

## What the extension accesses

The extension starts your installed Codex app-server and requests `account/rateLimits/read`. Codex handles its existing login. The extension does not read credential files, submit model work, redeem resets, or change account settings.

Returned data is reduced to numeric quota fields, timestamps and known status/type values. Account IDs, credit IDs, arbitrary titles, tokens and raw error text are not displayed or stored. There is no telemetry or persistent account cache. Queries have a timeout and output limit.

Pi extensions run with your user permissions; this is not a sandbox. Use a trusted Codex executable and PATH. The Codex subprocess inherits the normal process environment and manages its own authentication.

## Shipping checks

The package contains the single-file runtime and documentation, not development dependencies, tests, credential files or local artifacts. `npm run check` verifies the package allowlist and common secret patterns. Failures print rule names and relative filenames, not file contents or matched values.

Before publishing, also scan Git history and the packed archive with a dedicated secret scanner, using redaction. Pattern scans are not a guarantee against every possible secret. Git author names/emails are public metadata when commits are pushed; review them separately.

## Known development dependency advisory

The pinned Pi 1.0.0 **development dependency** brings `brace-expansion` 5.0.9 through its published shrinkwrap. npm reports denial-of-service advisories, including [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr); 5.0.12 is the patched version. Standard update/audit-fix and a root override did not replace the shrinkwrapped version during review.

The upstream shrinkwrap also leaves seven development-only registry entries without lockfile integrity hashes. Their URLs use HTTPS on the public npm registry, but this is a reproducibility/hardening gap, not evidence that their contents were independently verified.

This code is **not included in the extension bundle or npm archive**, but it remains an upstream risk in the development/test toolchain. Do not treat the dependency audit as clean. Upgrade the pinned test host when an appropriate upstream fix is available and rerun the loader regressions; do not silently patch installed dependencies or suppress the advisory.

## Reporting

Do not put credentials, account identifiers or raw account responses in public reports. Use a private maintainer channel for suspected vulnerabilities; share redacted reproduction steps and affected versions.
