---
"@zitadel/components": patch
"@zitadel/config": patch
---

`<zitadel-login>` now shows the project's minimum password length under the password field while someone chooses a password, instead of only after a too-short submit. The designs `zitadel branding eject` copies show it too; a template you ejected earlier gets it by adding `| fieldRuleHint: f` to its `field_help` line. A field's clear button no longer appears while the field is empty.
