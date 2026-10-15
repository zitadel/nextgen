---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
"@zitadel/cli": patch
---

Identity provider connections are OIDC only. The `oauth2` protocol is removed
from the connection schema and the API, together with the `supplementary_fetch`
strategy and the `"$supplementary_fetch"` value in `verified_claims`. The
engine never served either, so such a connection showed a sign-in button that
could not work.

Breaking for stored data: the server's next start deletes every `oauth2`
connection stored by an earlier release, with its revisions and identity links.

`POST /idps` now refuses, at create and at revise, an OIDC connection the engine
could not start a sign-in with: an `oidc` block that sets an endpoint without
the others fails with `400 idp.endpoints_partial`, and the error details list
the missing endpoints. Set no endpoint and let discovery fill them, or set
`authorization_endpoint`, `token_endpoint`, `jwks_uri`, and `userinfo_endpoint`
(`userinfo_endpoint` may be left out when `id_token_mapping` is on). Nothing is
stored, and a revise leaves the current revision unchanged. `zitadel plan`
reports the same problem before anything is applied, and `zitadel apply` names
the missing endpoints when the server refuses one.
