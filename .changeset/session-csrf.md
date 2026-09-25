---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": patch
---

State-changing requests authenticated by the Console session cookie are now protected against cross-site request forgery. A cross-site browser request is refused with `403 auth.csrf_invalid`, and the management writes, `claim/complete` and `PATCH /users/me` must also send the session's token (`csrf_token` from `GET /sessions/me`) in the `X-Zitadel-CSRF` header. Requests made with a project secret are unaffected. The generated client adds the header automatically once `setApiCsrfToken` is set, and `zitadel setup` sends it when it claims a project for the local admin.
