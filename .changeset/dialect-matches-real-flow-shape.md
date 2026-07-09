---
"@zitadel/config": patch
"@zitadel/cli": patch
---

The offline dialect meta-schemas now match the real config shape. The
flow dialect's `steps[].actions` was an object map with no `name`/`kind`
— editors flagged every valid flow file; it is now the array of
`{name, kind, ...}` the platform actually accepts (with the declarable
kind enum), and the root allows the scaffolded `$schema` pointer and
`status`. `zitadel setup` also materializes `auth-methods.json` /
`auth-method.json` so `user-schema.json`'s `$ref`s resolve offline.
Tests now validate every shipped default and preset file against the
dialect, and assert all relative `$ref`s resolve within the
materialized set.
