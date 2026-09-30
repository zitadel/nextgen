---
"@zitadel/sdk-qwik": minor
"@zitadel/cli": minor
---

Migrate @zitadel/sdk-qwik from Qwik 1 (@builder.io/qwik) to Qwik 2 (@qwik.dev/core). The package now declares a peer dependency on @qwik.dev/core ^2.0.0-beta.45, so consuming apps must run on Qwik 2. Because Qwik 2 supports Vite 8, the SDK family and apps/cli no longer need the separate Vite 7 / Vitest 3 pin: the sdk pnpm catalog is collapsed into the root catalog and the whole workspace now resolves Vitest 4 / Vite 8. Test tooling only for every package except sdk-qwik and the CLI.

The CLI's Qwik scaffolding now targets Qwik 2 to match the SDK: `zitadel setup` scaffolds a Qwik 2 (@qwik.dev/core) app on Vite 8 instead of pinning Vite to v7, its framework detector recognises @qwik.dev/core apps (a Qwik 1 app is no longer matched, since it would receive an incompatible SDK peer), and the generated auth entry imports from @qwik.dev/core.
