---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-router": patch
"@zitadel/sdk-tanstack-start": patch
---

Signing in from a deep link now brings you back with its query string. The middleware of `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-sveltekit`, `@zitadel/sdk-solid-start`, `@zitadel/sdk-qwik-router` and `@zitadel/sdk-tanstack-start` sent a signed-out visit to `/dashboard?tab=billing` to `/login?next=%2Fdashboard`, so the filters and tabs in the link were lost after sign-in. It now keeps the query in `next` (`/login?next=%2Fdashboard%3Ftab%3Dbilling`), and `<zitadel-login>` returns to `/dashboard?tab=billing`. A `next` parameter on the visited URL itself is left out, so one login redirect never nests inside another. `@zitadel/sdk-core/middleware` exports the rule as `loginRedirectUrl(loginPath, requestUrl)` for custom integrations.
