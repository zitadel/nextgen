---
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

`<zitadel-session>` and `<zitadel-logout>` now fire `zitadel-session-error` when loading the
session or signing out fails with anything other than the backend's no-session answer, such as a
5xx, a network error, a gateway's error page or a response that is not a session. The detail is
`{ status?, code?, message, phase }`, with `phase` set to `"load"` or `"signout"`, so an app can tell
an outage from a signed-out visitor and end its own "signing out" state when a sign-out fails. The
widgets still keep their surface and show the error. The SDKs surface the event as `onSessionError`
(React, Svelte, Solid and the meta-framework SDKs that re-export them), `sessionError` (Vue,
Angular) and `onSessionError$` (Qwik), with the detail typed as `ZitadelSessionErrorDetail`; Nuxt
and Next templates listen to `zitadel-session-error` on the raw elements.
