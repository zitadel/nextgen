---
"@zitadel/testing": minor
---

`@zitadel/testing/vitest` runs backend tests against a real local instance without Playwright: `zitadelGlobalSetup()` boots one instance per Vitest run and stops it afterwards, and `injectZitadel()` gives each test the same seeding surface as `connectZitadel()`, including `seedSession()` for calling your API with a real session. See the [package README](https://github.com/zitadel/nextgen/tree/main/packages/testing#readme).
