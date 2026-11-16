---
"@zitadel/cli": minor
---

The Vite dev proxy `setup` writes for React, Vue, Solid, Svelte and Qwik reads the server's address from `ZITADEL_URL`, falling back to the server setup ran against, so a test run can point the app at its own server. See [Test your app](https://preview.zitadel.com/docs/guides/test-your-app#other-frameworks).

**Upgrading an app set up before:** `doctor --fix` updates its proxy. With the app's env files unchanged it reaches the same server; a `ZITADEL_URL` the shell or CI exports now applies.
