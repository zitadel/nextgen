---
"@zitadel/server": minor
"@zitadel/config": minor
---

A user schema must declare `objectType`. `POST /schemas` refuses one without it, and the shipped user-schema meta-schema requires it.
