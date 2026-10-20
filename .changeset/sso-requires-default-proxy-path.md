---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

The `proxyPath` docs state that sign-in with an external provider currently requires the default `/__nextgen`: the provider returns to `/__nextgen/idp/callback`, which a custom prefix does not forward.
