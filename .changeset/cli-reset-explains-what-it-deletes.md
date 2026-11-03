---
"@zitadel/cli": patch
---

`zitadel reset` now says what it deletes before it asks: the local server's database in the project's `.zitadel/local/nextgen-data`, which cannot be undone, and that it keeps the local admin sign-in and the rest of the project.
