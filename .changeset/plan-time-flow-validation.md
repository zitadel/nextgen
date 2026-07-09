---
"@zitadel/config": patch
"@zitadel/cli": patch
---

`plan` and `apply` now validate flow definitions against the same rules the
server enforces — before any mutation. A flow missing an invariant (e.g. a
login entry step without `user_not_found -> register` while `register` is a
wired purpose) fails at plan time with the server's exact wording instead of
half-applied after the schema already revised. Errors aggregate across flows
(`--json` carries structured `details.issues`); product guidance surfaces as
non-blocking `# warning:` lines in the plan. The validator ships as
`@zitadel/config/validate`. Escape hatch: set `ZITADEL_SKIP_FLOW_VALIDATION`
to skip the pre-flight if it ever disagrees with your server version.
