---
"@zitadel/cli": minor
"@zitadel/sdk-sveltekit": minor
---

`zitadel setup --framework sveltekit` now declares `ZITADEL_URL`, `ZITADEL_PROJECT_SECRET` and `ZITADEL_PROJECT_ID` in `src/env.ts`, writing the file or adding them to the app's own, and the `src/hooks.server.ts` it writes reads them from SvelteKit's server-only `$app/env/private` instead of loading `.env.local` onto `process.env`. The hook names no Node global, so `npm run check` passes without `@types/node` instead of reporting "Cannot find name 'process'", and an app missing one of the settings fails with an error naming it instead of proxying to a default server.

**Breaking:** setup refuses SvelteKit 2 apps, which have no `$app/env/private`, and `zitadel doctor` and `zitadel eject` no longer recognize a SvelteKit 2 app set up by an earlier release. `@zitadel/sdk-sveltekit` now peers on `@sveltejs/kit` 3 only. Upgrade to SvelteKit 3 first.
