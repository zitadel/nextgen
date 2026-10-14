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

A visitor without a session no longer sees a "Signed in as" card for nobody, or a Sign out button
that fails with a 401. When `GET /sessions/me` answers 401 or 404, `<zitadel-session>` and
`<zitadel-logout>` fire the new `zitadel-session-missing` event and render nothing, and
`<zitadel-session>` goes to its `post-sign-out-url` when one is set. A sign-out answered 401 or 404
now completes like any other (the session is already gone). A network error or a 5xx keeps the
widget and shows the error. The SDKs surface the event as `onSessionMissing` (React, Svelte, Solid),
`sessionMissing` (Vue, Angular) and `onSessionMissing$` (Qwik). A page that relied on the empty
card must now handle the missing session itself, for example by setting `post-sign-out-url`.
