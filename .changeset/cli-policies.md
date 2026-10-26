---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel deploy` now carries operation policies from `.zitadel/policies/`. Each file is named after its operation and holds `{"operation": "auth.factor.password.set", "config": {"min_length": 15}}`; the release build publishes a changed one as a new revision of the policy and pins it. `deploy` checks every file against the new `.zitadel/meta/policy.json` editor schema and its name before anything is sent. `zitadel policies list` and `zitadel policies get <id|operation>` read policies back, and `get` shows the policy's `config`. Sign-ins and sign-ups use the policy the deployed release carries, so deploying without a file switches that policy off there; a password set through the API, or before the first deploy, still uses the newest revision. `get --help` now names what the argument takes for resources addressed by more than an id.
