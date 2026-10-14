---
"@zitadel/server": minor
---

`POST /releases` checks that a release is complete and consistent: every schema and identity provider its flows and schemas name must be in the release, and every flow must fit the user schema it is released with. Releases can now include identity provider connections.
