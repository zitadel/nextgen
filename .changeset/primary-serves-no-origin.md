---
"@zitadel/server": minor
"@zitadel/cli": patch
---

**Breaking:** `POST /flow` is served the project's newest primary deployment, not the newest revisions, when there is one and the request has no `Origin`. The same holds for a request from a console origin the project does not list, such as `https://console.example.com`. That deployment stays live whatever the project lists, so its release cannot be revoked.
