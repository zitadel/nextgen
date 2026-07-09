---
"@zitadel/config": patch
---

The flow-definition dialect meta-schema (scaffolded into `.zitadel/meta/` and
embedded by the server) now matches the flow files the platform actually
produces: `steps[].actions` is an array of `{ name, kind, primary, text_key }`
(name and kind required, kind enumerating submit/passkey/passkey_register/
navigate/back), top-level `status` is declared and required, and the
editor-only `$schema` pointer is allowed. Previously the schema modelled
actions as an object map without name/kind, so editors flagged every
scaffolded flow as invalid. A hygiene test now validates each preset's
rendered flow against the dialect.
