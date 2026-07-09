---
"@zitadel/config": patch
"@zitadel/cli": patch
"@zitadel/server": patch
"@zitadel/components": patch
---

Disabling passkey in the user schema (`x-auth-methods.passkey.enabled: false`)
is now enforced for flows. A flow step declaring a `passkey` or
`passkey_register` action against a schema that does not enable passkey fails
validation at plan time (and on the server at apply time) with
`step "…": action "…" offers passkey but "passkey" is not an enabled
authentication method` — the same treatment the `x-auth-methods#password`
field already gets. Previously the schema toggle applied successfully but
/login and /register kept offering and accepting passkeys.

For flows applied before this rule, the server closes both halves at runtime:
steps render **without** their passkey actions (the buttons disappear rather
than erroring on click), and a direct submission of a hidden action is refused
with `error.passkey_disabled` — localized in every builtin locale. Refusal
covers assertion of already-registered credentials too: `x-auth-methods` is an
enforcement declaration, so a disabled method never signs anyone in.
