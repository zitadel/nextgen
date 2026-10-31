---
"@zitadel/server": minor
"@zitadel/cli": patch
---

`POST /flow` with no `Origin`, and one admitted without a project pattern with nothing deployed to its origin, is served the project's newest primary deployment when there is one.
