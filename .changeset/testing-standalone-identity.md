---
"@zitadel/testing": minor
---

`identity()` is now its own export of `@zitadel/testing` and
`@zitadel/testing/playwright`: an unused email and password for registration
tests, also in suites that run without `withZitadel()` and so have no `seed`
fixture. `SESSION_COOKIE_NAME` is now exported from
`@zitadel/testing/playwright` too, so a Playwright spec takes everything from
that one entry point.
