---
"@zitadel/server": minor
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

Each sign-in provider connection now has its own callback route, `GET /__nextgen/idp/{slug}/callback`, also served as `/idp/{slug}/callback` for a scaffolded app's SDK proxy. The authorize request and the token exchange send it as `redirect_uri`. The shared `/__nextgen/idp/callback` route is retired: if you registered it at a provider, register the connection's own URI instead, for example `http://localhost:3000/__nextgen/idp/google/callback`, or the provider answers `redirect_uri_mismatch`. `zitadel sso enable --provider <slug>` prints it. A callback that still reaches the retired route gets the callback's uniform error page; its `code` and `state` are redacted from the request log as before. The route defends against the IdP mix-up attack (RFC 9700 §4.4): a callback whose path names another connection than the one the sign-in started with is refused before any code exchange, the step the sign-in started from shows `error.sso_failed`, and the events stream records `auth.sso.exchange.failed`, or `auth.sso.authorization.failed` when no code arrived. When the provider sends the RFC 9207 `iss` parameter, the callback also refuses a value that is not the connection's issuer, the same way. The SDK `proxyPath` docs name the new route.
