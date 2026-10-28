---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel policies test` runs the cases in `.zitadel/policies/<operation>.test.json` against your policy. Each case gives the operation's input (for the password policy, the password itself), optionally the facts the operation would look up (`self_service`, `history_matches`), and the decision it expects: `allowed`, and optionally the error `code` and exactly the `violations`. Zitadel evaluates every case as a real password set would, so a case also covers how the password is counted. By default the cases run against the policy file beside them; `--release <id>` runs them against the policy a built release pins, before you deploy it. A failing case fails the command with `E_VALIDATION` and lists what was expected and what Zitadel decided. `deploy` never carries test files, editors validate them against the new `.zitadel/meta/policy-test.json`, and the policies README that `setup` writes shows an example.
