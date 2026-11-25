---
title: Keep your password policy in your repository
summary: zitadel setup writes a password policy with a 15-character minimum for every new project, and zitadel deploy ships the policies in .zitadel/policies/ with each release.
date: 2026-10-27T23:26Z
pulls: [2270, 2279]
---

`zitadel deploy` now carries operation policies from `.zitadel/policies/`, one file per operation, checked against the `.zitadel/meta/policy.json` schema before anything is sent. `zitadel policies list` and `policies get` read them back. Sign-ins and sign-ups use the policy the deployed release carries, so deploying without a file switches that policy off.

`zitadel setup` writes and publishes a password policy for every new project, `.zitadel/policies/auth.factor.password.set.json`, with a minimum of 15 characters, NIST's minimum without a second factor, and a README on its settings. The wizard offers 15, 8 or none, and `--password-min-length <n>` sets another, `0` none. Change the file and publish it with `zitadel deploy`.

**Breaking:** a scripted `zitadel setup` now publishes a 15-character minimum. If your scripts or tests register users with shorter passwords, use longer ones, or pass `--password-min-length` with the length you need.

[zitadel policies list](https://preview.zitadel.com/docs/reference/cli/policies/list)
