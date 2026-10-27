---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel deploy` now carries operation policies from `.zitadel/policies/`, one file per operation, checked against the new `.zitadel/meta/policy.json` schema before anything is sent; `zitadel policies list` and `policies get` read them back ([docs](https://preview.zitadel.com/docs/reference/cli/policies/list)). Sign-ins and sign-ups use the policy the deployed release carries, so deploying without a file switches that policy off.
