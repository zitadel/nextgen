---
"@zitadel/components": patch
---

`<zitadel-session>` and `<zitadel-logout>` now treat a visitor without a session as signed out. When `GET /sessions/me` answers `401 auth.unauthorized` or `404 sess.not_found` (or names no user), the card and the avatar menu render nothing instead of "Signed in as" with a Sign out button for nobody, and the card navigates to `post-sign-out-url` when one is set. Only the backend's own answers count: a network error, a 5xx, a gateway's 401 or 404 without the backend's code, or a 200 that is not a session keeps the widget and shows the error. A sign-out the backend answers with "no session" now succeeds, since the session is already gone.
