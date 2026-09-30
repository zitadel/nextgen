---
"@zitadel/sdk-qwik": minor
---

Migrate @zitadel/sdk-qwik from Qwik 1 (@builder.io/qwik) to Qwik 2 (@qwik.dev/core). The package now declares a peer dependency on @qwik.dev/core ^2.0.0-beta.45, so consuming apps must run on Qwik 2. Because Qwik 2 supports Vite 8, the SDK family and apps/cli no longer need the separate Vite 7 / Vitest 3 pin: the sdk pnpm catalog is collapsed into the root catalog and the whole workspace now resolves Vitest 4 / Vite 8. Test tooling only for every package except sdk-qwik.
