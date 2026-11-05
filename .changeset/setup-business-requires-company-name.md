---
"@zitadel/cli": patch
---

`zitadel setup` with the business use case now marks `companyName` as required in the generated user schema, so a sign-in that does not supply a company name, such as Google, asks for it instead of creating the user without one.
