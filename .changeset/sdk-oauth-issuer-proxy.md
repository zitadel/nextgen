---
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-qwik-router": minor
---

The server SDKs' proxy now serves the metadata of your project's OAuth issuer at `/.well-known/oauth-authorization-server/__nextgen/oauth/<project id>`, and tells the server its proxy path and your `loginPath` on every request, so an authorization request lands on your login page. OAuth paths of any other project answer `404`.

**Upgrading a Next.js app:** if you narrowed the middleware's `matcher`, add `/.well-known/oauth-authorization-server/:path*` to it.
