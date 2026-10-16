---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

The session documentation now matches what the SDKs do. `NextgenSession.token` is described as the
session token the request carried (a verified JWT, or the backend's opaque session token), not only
a JWT, and the Nuxt README and agent skill say `useAuth()` omits that token. The
`zitadel-session-missing` event is documented as firing only for the backend's own no-session
answer. The Next.js agent skill lists `getClientAuth()`.
