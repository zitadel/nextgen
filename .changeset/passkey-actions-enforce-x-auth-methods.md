---
"@zitadel/config": patch
"@zitadel/cli": patch
---

Disabling passkey in the user schema (`x-auth-methods.passkey.enabled: false`)
is now enforced for flows. A flow step declaring a `passkey` or
`passkey_register` action against a schema that does not enable passkey fails
validation at plan time (and on the server at apply time) with
`step "…": action "…" offers passkey but "passkey" is not an enabled
authentication method` — the same treatment the `x-auth-methods#password`
field already gets. Previously the schema toggle applied successfully but
/login and /register kept offering and accepting passkeys.
