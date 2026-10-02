---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": patch
---

State-changing requests authenticated by the Console session cookie are now protected against cross-site request forgery. A cross-site browser request is refused with `403 auth.csrf_invalid`, and every such write except sign-out and the `POST …/query` reads must also send the session's token (from the new `GET /sessions/me/csrf`) in the `X-Zitadel-CSRF` header; the code is listed in each affected operation's default error responses. Requests made with a project secret are unaffected. The generated client adds the header automatically once `setApiCsrfToken` is set and reports a refusal to `setApiCsrfRejectionHandler`, so an app can load a fresh token after the session changed in another tab; the refused request is not retried. `zitadel setup` sends it when it claims a project for the local admin.
