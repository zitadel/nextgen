---
"@zitadel/server": patch
---

A caller who reaches a project through a team grant whose members live in another project now gets HTTP 403 when they lack the specific permission, instead of 404 as if the project did not exist.
