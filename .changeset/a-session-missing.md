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
that fails with a 401. When the backend answers that there is no session (`401 auth.unauthorized`
or `404 sess.not_found`) or the session names no user, `<zitadel-session>` and `<zitadel-logout>`
fire the new `zitadel-session-missing` event and render nothing, and `<zitadel-session>` goes to its
`post-sign-out-url` when one is set, unless that URL is the page the card is on (then it only
renders nothing, so a card whose sign-out returns to its own page does not reload it forever). A
sign-out the backend answers that way now completes like any other (the session is already gone).
Anything else, such as a gateway's 401 or 404 page, an HTML 200 from the app host, a 403, a 429, a
5xx or a network error, keeps the widget and shows the error, and a sign-out that gets one of those
fires no `zitadel-signout` and does not navigate. The SDKs surface the event as `onSessionMissing`
(React, Svelte, Solid), `sessionMissing` (Vue, Angular) and `onSessionMissing$` (Qwik). A page that
relied on the empty card must now handle the missing session itself, through that event or by
pointing `post-sign-out-url` at another page such as the login page.
