---
"@zitadel/server": minor
"@zitadel/cli": patch
---

A request is served only what its release pins: a flow, user schema, identity provider, branding, or policy the release leaves out is not served, and a request with no release answers `rel.not_deployed`. `setUserPassword` applies the password policy of the release that serves the caller's `Origin`, so a frontend on a preview URL gets that preview's policy; the console's own origin and a caller with no `Origin` get the project's newest primary deployment. `createAuthAttempt` always follows the newest primary deployment. With no primary deployment both answer `409` with `rel.no_default`.

**Breaking:** publishing a flow, schema, identity provider, branding, or policy no longer changes sign-in or `setUserPassword` until a release that pins it is deployed.
