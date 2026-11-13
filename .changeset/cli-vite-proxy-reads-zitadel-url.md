---
"@zitadel/cli": minor
---

The Vite dev proxy `setup` writes for React, Vue, Solid, Svelte and Qwik reads the server's address from `ZITADEL_URL`, falling back to the server setup ran against, so a test run can point the app at its own server. `doctor --fix` updates an older proxy without changing which server it reaches. See [Test your app](https://preview.zitadel.com/docs/guides/test-your-app#other-frameworks).
