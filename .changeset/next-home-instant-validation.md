---
"@zitadel/cli": patch
"@zitadel/sdk-next": patch
---

A Next.js app created by `zitadel setup --framework next` no longer logs ``Could not validate `instant` `` errors in `next dev` on every request to `/`. The home page setup writes still redirects to `/login`, and now opts out of Next.js's instant-navigation check, which Cache Components (on by default in new Next.js apps) runs on every page. The `@zitadel/sdk-next` README's `auth()` examples now render the component that calls `auth()` inside `<Suspense>` and import it from `@zitadel/sdk-next/server`, so they build with Cache Components on.
