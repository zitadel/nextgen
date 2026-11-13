---
"@zitadel/cli": minor
---

`zitadel tests add` adds a first end-to-end test to a Next.js app that `zitadel setup` wired up: a Playwright config on `@zitadel/testing` and a test that signs a seeded user in, with both packages as dev dependencies. Each run boots its own Zitadel server, and `setup` still installs no test tooling: https://preview.zitadel.com/docs/guides/test-your-app
