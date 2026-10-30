---
"@zitadel/server": minor
"@zitadel/cli": patch
---

A deployment can name the `default` target, alone or together with `primary`. `POST /flow` with no `Origin`, and one admitted without a project pattern with nothing deployed to its origin, is served that deployment when there is one. Platform bootstrap deploys the platform project to its primary origin and to `default`.
