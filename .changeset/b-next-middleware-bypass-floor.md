---
"@zitadel/sdk-next": patch
---

`@zitadel/sdk-next` now requires Next.js 15.2.3 or later; the `next` peer range moves from `>=15` to
`>=15.2.3`. Next.js 15.0.0 to 15.2.2 skip middleware for a request that sends an
`x-middleware-subrequest` header (CVE-2025-29927), so on self-hosted deployments (`next start`) anyone
could reach a route that relies on `protectedRoutes` alone. Apps locked to 15.0.x through 15.2.2 will see
an unmet peer dependency warning, or an install error under npm, until they upgrade Next.js.
