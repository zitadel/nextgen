---
"@zitadel/server": minor
"@zitadel/cli": patch
---

**Breaking:** `POST /flow` with no `Origin`, and one admitted without a project pattern with nothing deployed to its origin, is served the project's newest primary deployment when there is one, not the newest revisions. That deployment stays live whatever the project lists, so its release cannot be revoked.
