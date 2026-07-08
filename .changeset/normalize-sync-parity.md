---
"@zitadel/config": patch
"@zitadel/cli": patch
---

Make `plan` diffs trustworthy and keep local config in lockstep with live
state. `@zitadel/config/normalize` is the shared canonical-form normalizer
(drops the server's empty `audience` echo and spelled-out `x-*` meta-schema
property defaults); the sync engine hashes and diffs in normalized form
(with a legacy-hash fallback so existing state files don't read as edits),
and setup/apply write the server's canonical body back to the local file —
reported in human and `--json` output — so a one-field edit renders as a
one-field diff and applying can no longer silently strip live settings.
The api-mock now mirrors the server's unconditional `audience` echo.
