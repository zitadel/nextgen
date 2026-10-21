---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-qwik-router": minor
"@zitadel/components": patch
"@zitadel/testing": patch
"@zitadel/cli": patch
---

The server SDKs now count a session as signed in only when it belongs to the
app's own project. A session of another project on the same server, such as a
second app on the same host or the console of a local `zitadel start`, reads
as signed out in `protectedRoutes`, `auth()` and `getAuth()`, and its cookie is
left in place for the app it belongs to.

The project comes from the new `projectId` middleware option, else
`ZITADEL_PROJECT_ID`, else the framework's public project id variable
(`NEXT_PUBLIC_`, `VITE_` or `PUBLIC_ZITADEL_PROJECT_ID`). `zitadel setup`
already writes these to `.env.local`. A deployment that sets none of them must
set `ZITADEL_PROJECT_ID`, or nobody is signed in. With `@zitadel/sdk-nuxt`, the
public project id (`NUXT_PUBLIC_ZITADEL_PROJECT_ID`) decides unless
`nextgen.projectId` names one, so a built server follows it at runtime. A JWT
session token must name the project in its `aud` claim. `auth()` in
`@zitadel/sdk-next` also takes the project of `configureZitadel()`; with
`createProxy(config)`, pass the same project to `auth()` when it lives only in
that handle.

`GET /sessions/me` takes an optional `project_id` and answers a session of
another project with `403 sess.project_mismatch`. The SDKs send it, and so do
`getSession()` in `@zitadel/sdk-next`, `<zitadel-session>`, `<zitadel-logout>`
and the console. `getSession()` takes the project from its `projectId` option,
`configureZitadel()` or `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, and without one reads
as signed out. Signing out with `<zitadel-logout>` or `<zitadel-session>` no
longer ends another project's session. The `AGENTS.md` guidance that
`zitadel setup` writes now tells agents to read the session this way.

A Bearer token that is not this app's no longer decides what happens to the
session cookie that came with it: the cookie is judged, and cleared only when
the backend refuses it, on its own.

In `@zitadel/api`, `getMySession()` now takes its query parameters first: call
`getMySession(undefined, init)` where you called `getMySession(init)`. In
`@zitadel/sdk-core`, `checkOpaqueSessionToken()` and
`validateOpaqueSessionToken()` take the project id as a fourth argument, and
`resolveSession()` is the one implementation of these rules behind every server
SDK's middleware.

The `@zitadel/sdk-next` middleware also no longer lets a session that has not
finished signing in through `protectedRoutes`.
