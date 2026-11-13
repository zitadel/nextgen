---
"@zitadel/server": minor
---

Every issuer still answers 404 until a project can turn OAuth on. Once one can, the OAuth authorization endpoint `/oauth/<project_id>/authorize` accepts authorization code requests from registered applications and sends the browser to the app's login page. A code challenge must use `S256`, OpenID Connect scopes are ignored for now, and each request records an `auth.request.created` event.
