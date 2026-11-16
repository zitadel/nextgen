---
"@zitadel/cli": minor
---

`zitadel tests add` adds end-to-end tests to a Next.js app that `zitadel setup` wired up: a Playwright config on `@zitadel/testing`, a test of the sign-in, a test that starts signed in, and a `test:e2e` script. Each run boots its own Zitadel server; `setup` still installs no test tooling: https://preview.zitadel.com/docs/guides/test-your-app
