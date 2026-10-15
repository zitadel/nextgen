---
---

Only the CI test setup of `@zitadel/components` and `@zitadel/sdk-qwik` changes (`moon.yml`, `turbo.json` and the `test` script in `package.json`): their browser-mode suites no longer wait for each other. Nothing a consumer installs or runs changes.
