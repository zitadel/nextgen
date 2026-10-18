---
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
---

`<zitadel-session>` and `<zitadel-logout>` now fire `zitadel-session-error` when loading the session or signing out fails with anything other than the backend's no-session answer, such as a 5xx, a network error, a gateway's error page or a response that is not a session. The detail is `{ status?, code?, message, phase }`, with `phase` set to `"load"` or `"signout"`, so an app can tell an outage from a signed-out visitor and end its own "signing out" state when a sign-out fails. A widget removed from the page while its session request was in flight reports the failure once it is put back, and a sign-out that succeeds meanwhile fires `zitadel-signout` then. The widgets still keep their surface and show the error. The SDKs surface the event as `onSessionError` (React, Svelte, Solid), `sessionError` (Vue, Angular) and `onSessionError$` (Qwik), with the detail typed as `ZitadelSessionErrorDetail`.
