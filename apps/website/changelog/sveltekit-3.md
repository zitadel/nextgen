---
title: SvelteKit apps move to SvelteKit 3
summary: The hooks zitadel setup writes for SvelteKit read their settings from SvelteKit 3's private env module, and @zitadel/sdk-sveltekit now needs SvelteKit 3.
date: 2026-10-27T23:26Z
pulls: [2383]
---

The `src/hooks.server.ts` that `zitadel setup --framework sveltekit` writes now reads `ZITADEL_URL`, `ZITADEL_PROJECT_SECRET` and `ZITADEL_PROJECT_ID` from SvelteKit's `$app/env/private`, declared in `src/env.ts`. `npm run check` passes without `@types/node`, and a missing setting fails with an error naming it instead of proxying to a default server.

**Breaking:** `@zitadel/sdk-sveltekit` now peers on `@sveltejs/kit` 3 only, and setup refuses SvelteKit 2 apps, which have no `$app/env/private`. `zitadel doctor` and `zitadel eject` no longer recognize a SvelteKit 2 app set up by an earlier release. Upgrade to SvelteKit 3 first.

[The SvelteKit SDK](https://preview.zitadel.com/docs/sdks/sveltekit)
