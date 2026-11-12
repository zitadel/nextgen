---
"@zitadel/server": minor
"@zitadel/components": minor
---

Protect Flow API password and passkey signup with built-in PBKDF2 proof of
work, a browser solver, single-use proofs and per-flow retry limits.
`<zitadel-login>` solves it, and `solveSignupPow` from `@zitadel/components`
solves it for a signup client of your own.

**Breaking:** the server refuses a password signup, or a passkey registration
that creates the user, without a proof (`403 flow.proof_invalid`).
`<zitadel-login>` 0.5.0 and older sends none, so upgrade `@zitadel/components`,
or the SDK that pins it, together with the server. A custom or headless signup
client fetches the current step, solves `step.gates.signup_pow` and submits the
result as `gate_proofs.signup_pow`, with the password or with the passkey's
attestation.
