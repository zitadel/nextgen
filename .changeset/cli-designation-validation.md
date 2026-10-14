---
"@zitadel/config": minor
"@zitadel/cli": minor
---

Validate user-schema identity designations at plan time. `schemaConfigSchema`
now ports the server's designation rules (`x-identifier` must name a reachable
scalar leaf carrying `x-unique: "project"`, `x-display` entries must name
reachable scalar leaves, and a password-enabled schema must designate an
identifier), so `zitadel plan`, `apply`, and `doctor` reject a schema file
locally with the server's own error messages instead of letting apply fail
with a 400. Unlike the server (fail-fast), the CLI reports every violation at
once.
