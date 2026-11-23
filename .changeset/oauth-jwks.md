---
"@zitadel/server": minor
---

With `oauth.enabled`, `/oauth/<project_id>/jwks`, the `jwks_uri` of a project's issuer, serves the public keys of the project's token signing keys as a JWK set, so a backend can verify the project's access tokens. The set answers once the project's newest primary deployment carries `oauth: { "enabled": true }`; any other project answers 404, as one that does not exist does. A verifier may cache the set for `oauth.jwks_max_age`, 5 minutes by default.
