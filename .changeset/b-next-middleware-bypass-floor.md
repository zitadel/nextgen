---
"@zitadel/sdk-next": major
---

`@zitadel/sdk-next` now requires Next.js 15.2.3 or later. Next.js 15.0.0 to 15.2.2 skip middleware
for a request that sends an `x-middleware-subrequest` header (CVE-2025-29927), so on those versions
anyone could reach a route that relies on `protectedRoutes` alone. Upgrade Next.js if your package
manager now reports an unmet peer dependency. The package's agent skill now names the same floor.
