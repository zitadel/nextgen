---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel setup` now writes and publishes a password policy for every new project, `.zitadel/policies/auth.factor.password.set.json`, with a minimum of 15 characters, NIST's minimum without a second factor, and a README on its settings. The wizard offers 15, 8 or none; `--password-min-length <n>` sets another, `0` none. Change it in the file and publish it with `zitadel deploy`.

**Breaking:** a scripted `zitadel setup` now publishes a 15-character minimum. If your scripts or tests register users with passwords shorter than 15 characters, use longer ones, or pass `--password-min-length` with the length you need.
