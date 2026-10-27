---
"@zitadel/cli": minor
"@zitadel/sdk-sveltekit": minor
---

The `src/hooks.server.ts` that `zitadel setup --framework sveltekit` writes now reads `ZITADEL_URL`, `ZITADEL_PROJECT_SECRET` and `ZITADEL_PROJECT_ID` from SvelteKit's `$app/env/private`, declared in `src/env.ts`, so `npm run check` passes without `@types/node`, and a missing setting fails with an error naming it instead of proxying to a default server.

**Breaking:** setup refuses SvelteKit 2 apps, which have no `$app/env/private`, and `zitadel doctor` and `zitadel eject` no longer recognize a SvelteKit 2 app set up by an earlier release. `@zitadel/sdk-sveltekit` now peers on `@sveltejs/kit` 3 only. Upgrade to SvelteKit 3 first.
