---
"@zitadel/cli": patch
---

`zitadel deploy --dry-run` now stops on a flow whose `user_schema` names a schema that neither `.zitadel/schemas/` nor the project holds, instead of passing it for the deploy to be refused.
