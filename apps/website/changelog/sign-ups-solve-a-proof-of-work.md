---
title: Sign-ups solve a proof of work
summary: Every password or passkey sign-up now solves a built-in proof of work, which <zitadel-login> handles for you, and zitadel setup writes the sign-up policy that names it. Upgrade the login components together with the server.
date: 2026-11-11T18:16Z
cloud: true
pulls: [2626, 2839]
---

Sign-up through the Flow API is now protected by a built-in proof of work: the browser solves a short challenge before the server creates the user, each proof works once, and every flow has a retry limit. `<zitadel-login>` solves it for you. For a sign-up client of your own, `solveSignupPow` from `@zitadel/components` solves it.

- `zitadel setup` writes the sign-up policy, `.zitadel/policies/user.create.json`, beside the password policy. It names the challenge, which applies with or without the file. Deploy it like any other policy; `POST /policies` and `zitadel policy test` take `user.create` too.
- A headless client fetches the current step, solves `step.gates.signup_pow`, and submits the result as `gate_proofs.signup_pow` with the password or with the passkey's attestation.

**Breaking:** the server refuses a password sign-up, or a passkey registration that creates the user, without a proof (`403 flow.proof_invalid`). `<zitadel-login>` before 0.7.0 sends none, so upgrade `@zitadel/components`, or the SDK that pins it, together with the server. On preview.zitadel.com this applies from the date above.

[Policies](https://preview.zitadel.com/docs/guides/deploy#policies)
