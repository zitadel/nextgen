---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add operation-specific error response schemas to the OpenAPI spec, so the
generated client exposes typed error models per endpoint.

Each operation's error set is inferred from the implementation rather than a
hand-maintained doc comment, and the inference now starts at the API handler
instead of the service it calls. That closes two gaps where an endpoint could
return an error its schema did not list — the authorization guard's
`not_found` / `permission_denied`, raised before any service is reached, and
the transport's `auth.unauthorized` / `req.invalid`, raised before a handler
runs at all. Because the generated client discriminates the error response on
`code`, an omitted code made a real response fail to decode instead of
surfacing as the error it is.

`auth.unauthorized` is listed only where the operation declares a security
requirement, so the health probes and the pre-authentication flow steps no
longer advertise an answer they cannot give.
