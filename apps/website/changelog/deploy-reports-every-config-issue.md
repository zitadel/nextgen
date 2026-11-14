---
title: zitadel deploy reports every configuration problem in one error
summary: Every CLI command now checks .zitadel/ by the same rules, and deploy, preview and release create report every problem in one E_VALIDATION, in plain words. This is a breaking change.
date: 2026-11-11T17:33Z
pulls: [2726, 2889, 2905]
---

Every CLI command now reads, checks and writes `.zitadel/` by the same rules. `deploy`, `preview` and `release create` report every problem in one `E_VALIDATION`, "Configuration validation failed (N issues)", whose `details.issues` lists each one's `rule`, `path` and `message`.

- New rules refuse a provider listed twice, a connection field its contract does not know, a claim name with surrounding whitespace and a literal `client_secret`. They warn about a claim whose scope the connection does not request, a claim mapped to a property of another type and a subject claim that can change.
- A user schema key JSON Schema does not define, such as a misspelt `minimumLength`, is refused before upload, and `zitadel doctor` reports it too.
- A refused value says what a valid one looks like, in place of a raw regex, and a file that is not valid JSON is named with the line and column of the error.

**Breaking:** the separate "Flow validation failed", "SSO configuration is not consistent" and "Missing environment variables" errors and their `handle` and `step` fields are gone: read `details.issues`. `deploy` asks before a release that would leave existing users unable to sign in, and a non-interactive run, `--dry-run` included, refuses with `E_CONFIRMATION_REQUIRED` unless given `--force`. The `auth-method` commands refuse while any file under `.zitadel/` does not parse or fails the per-file checks `deploy` makes, even a file they do not change, and report `notices` in place of `kept` and `untouched`. An older CLI cannot read a `.zitadel/state.json` that 0.6.0 creates.

[What deploy checks](https://preview.zitadel.com/docs/guides/deploy#what-deploy-checks-before-it-publishes)
