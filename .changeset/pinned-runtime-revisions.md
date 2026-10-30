---
"@zitadel/server": minor
"@zitadel/cli": patch
---

A request is served only what its release pins: a flow, user schema, identity provider, branding, or policy the release leaves out is not served, and a request with no release answers `rel.not_deployed`. `setUserPassword` and `createAuthAttempt` follow the default target and ignore the caller's `Origin`, answering `409` with `rel.no_default` when nothing is deployed there.

**Breaking:** publishing a flow, schema, identity provider, branding, or policy no longer changes sign-in or `setUserPassword` until a release that pins it is deployed.
