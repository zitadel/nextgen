---
"@zitadel/cli": patch
---

`zitadel auth-method` commands now accept a user schema's `objectType` in `--schema`, the name login flows use, as well as its file name. When a schema is missing or the name fits more than one, the error lists each schema by both names, and `--schema <file>.json` picks the file, as the commands' own suggestions now do.
