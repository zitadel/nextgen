---
"@zitadel/cli": patch
---

`zitadel setup` and `zitadel sso enable` show each connection's own redirect URI, `{issuer}/__nextgen/idp/{slug}/callback`, for example `http://localhost:3000/__nextgen/idp/google/callback`. The shared `/__nextgen/idp/callback` the previous release printed no longer works: rerun `zitadel sso enable --provider google` to see the new URI, which it now prints for an existing connection too, and register it with the provider. `setup --json` reports it as `callback_uri` on each `sso` entry, as `sso enable --json` already did.
