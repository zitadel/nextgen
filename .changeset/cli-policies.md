---
"@zitadel/cli": minor
"@zitadel/config": minor
---

The CLI now manages operation policies from `.zitadel/policies/`. Each file is named after its operation and holds `{"operation": "auth.factor.password.set", "config": {"min_length": 15}}`. `zitadel plan` checks it against the new `.zitadel/meta/policy.json` editor schema and shows the change, and `zitadel apply` publishes it as a new revision. `zitadel policies list` and `zitadel policies get <id|operation>` read policies back. A policy cannot be deleted: removing its file leaves the policy in place, and `"config": {}` switches it off. A removed file the platform keeps now says what to do instead in its warning.
