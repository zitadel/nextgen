---
"@zitadel/server": minor
---

Every issuer still answers 404 until a project can turn OAuth on. Once one can, the authorization endpoint `/oauth/<project_id>/authorize` accepts authorization code requests from registered applications and sends the browser to the login page. A request must send `state`, a code challenge must use `S256`, and OpenID Connect scopes are ignored for now. Each request records an `auth.request.created` event.
