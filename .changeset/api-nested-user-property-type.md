---
"@zitadel/api": patch
---

The generated client now types a user property nested in another property's `properties` as `UserProperty` instead of `unknown`. `UserProperty`, `UserPropertyProperties` and `UserPropertyXUnique` are new exports of `@zitadel/api/generated/model`, and the zod schemas validate the nested level as well.
