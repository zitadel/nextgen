---
title: Test your app against a real Zitadel server
summary: The new zitadel tests add gives a Next.js app end-to-end tests of its sign-in, and @zitadel/testing/vitest runs backend tests against a real local instance.
date: 2026-11-16T17:01Z
pulls: [3059, 3054, 3082, 3053]
---

`zitadel tests add` adds end-to-end tests to a Next.js app that `zitadel setup` wired up: a Playwright config on `@zitadel/testing`, a test of the sign-in, a test that starts signed in, and a `test:e2e` script. Each run boots its own Zitadel server. `setup` itself still installs no test tooling.

```sh
npx @zitadel/cli@latest tests add
```

- `@zitadel/testing/vitest` runs backend tests without a browser. `zitadelGlobalSetup()` boots an instance for the Vitest project that lists it and stops it when the run ends or is interrupted, and `injectZitadel()` gives each test the same seeding helpers as `connectZitadel()`, including `seedSession()` to call your API with a real session.
- In React, Vue, Solid, Svelte and Qwik apps, the Vite dev proxy that `setup` writes reads the server's address from `ZITADEL_URL`, so a test run can point the app at its own server. Run `zitadel doctor --fix` in an app set up before 0.7.0; a `ZITADEL_URL` that your shell or CI exports now applies.
- The guide shows how to sign seeded users in, start tests signed in and test passkeys.

[Test your app](https://preview.zitadel.com/docs/guides/test-your-app)
