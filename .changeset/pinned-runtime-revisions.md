---
"@zitadel/server": minor
---

A request serves only the revisions its release pins. A flow, user schema, identity provider, branding, or policy the release does not pin is absent, and a request with no release answers `rel.not_deployed`. `setUserPassword` and `createAuthAttempt` follow the default target and ignore the caller's `Origin`. Nothing deployed there answers `409` with `rel.no_default`.

**Breaking:** a request no longer runs the newest flow, schema, identity provider, branding, or policy when its release does not pin that kind. Publishing a policy without deploying it no longer changes sign-in or `setUserPassword`.
