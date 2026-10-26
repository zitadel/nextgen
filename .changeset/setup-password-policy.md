---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel setup` now writes and publishes the project's password policy, `.zitadel/policies/auth.factor.password.set.json`, with a README explaining its settings. The policy enforces nothing unless you give a minimum length: in the wizard, which suggests an example but preselects nothing, or with `--password-min-length <n>`. Change it later in the file and publish it with `zitadel deploy`.
