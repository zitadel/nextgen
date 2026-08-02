---
"@zitadel/testing": minor
---

Publish `@zitadel/testing`, the test-kit for seeded ephemeral local Zitadel
instances. `startLocalZitadel()` boots the real server (binary runtime +
embedded Postgres, no Docker) from test code and bootstraps a project with the
default login flow; `withZitadel()` generates the Playwright `webServer`
entries that boot the instance and your app without wrapper scripts; the seed
API mints password users per test (`seed.user()`), unused identities for
registration specs (`seed.identity()`), and headless sessions so tests start
past login (`seed.session()`, `authenticatedPage`). macOS/Linux; alpha, like
the rest of the train.
