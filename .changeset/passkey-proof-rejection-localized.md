---
"@zitadel/server": patch
"@zitadel/components": patch
---

Rejected passkey proofs now surface as localized alerts in /login instead of
leaking internal error literals. The flow engine emitted
`auth_attempt.passkey_invalid` (sign-in assertion rejected) and
`auth_attempt.passkey_registration_invalid` (registration attestation
rejected), but the login component only localizes step errors under the
`error.` prefix, so both keys rendered verbatim in the UI. The engine now
emits `error.passkey_invalid` and `error.passkey_registration_invalid`,
translated in every builtin locale.
