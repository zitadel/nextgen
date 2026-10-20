---
"@zitadel/server": patch
---

The Console's "Console API not authorized" screen no longer tells operators to check a development proxy secret. Every management call the Console makes is authorized by the signed-in person's session and their grants on the project, the same in development as in the embedded build.
