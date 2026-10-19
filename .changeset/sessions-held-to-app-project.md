---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-qwik-city": minor
"@zitadel/components": patch
"@zitadel/testing": patch
---

The server SDKs now count a session as signed in only when it belongs to the
app's own project. A session of another project on the same server, such as a
second app on the same host or the console of a local `zitadel start`, reads
as signed out in `protectedRoutes`, `auth()` and `getAuth()`, and its cookie is
left in place for the app it belongs to.

The project comes from the new `projectId` middleware option, else
`ZITADEL_PROJECT_ID`, else the framework's public project id variable
(`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_` or `PUBLIC_ZITADEL_PROJECT_ID`).
`zitadel setup` already writes these to `.env.local`. A deployment that sets
none of them must set `ZITADEL_PROJECT_ID`, or nobody is signed in. A JWT
session token must name the project in its `aud` claim.

`GET /sessions/me` takes an optional `project_id` and answers a session of
another project with `403 sess.project_mismatch`. The SDKs send it, and so do
`getSession()` in `@zitadel/sdk-next`, `<zitadel-session>`, `<zitadel-logout>`
and the console. In `@zitadel/api`, `getMySession()` now takes its query
parameters first: call `getMySession(undefined, init)` where you called
`getMySession(init)`.

The `@zitadel/sdk-next` middleware also no longer lets a session that has not
finished signing in through `protectedRoutes`.
