---
"@zitadel/server": patch
"@zitadel/components": patch
---

Every engine-emitted step error is now a localizable `error.*` catalog
key — no `auth_attempt.*` literals leak into the login UI anymore.
Rejected passkey proofs emit `error.passkey_invalid` (assertion) and
`error.passkey_registration_invalid` (attestation), translated in every
builtin locale; rejected password submissions emit the existing
`error.invalid_credentials`, which the login component routes inline to
the password field. The `step.error` contract docs now describe the
`error.*` catalog plus verbatim outcome tokens (e.g. `user_not_found`)
instead of citing `auth_attempt.*` diagnostics.
