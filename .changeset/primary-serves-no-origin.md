---
"@zitadel/server": minor
"@zitadel/cli": patch
---

**Breaking:** `POST /flow` is served the project's newest primary deployment, not the newest revisions, when there is one and the request has no `Origin`. The same holds for a request from an origin the project does not list but the server lets in anyway, such as a loopback origin like `http://localhost:3000` or a console origin like `https://console.example.com`, when nothing is deployed to that origin. That deployment stays live whatever the project lists, so its release cannot be revoked.
