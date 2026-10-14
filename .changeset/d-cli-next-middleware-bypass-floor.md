---
"@zitadel/cli": minor
---

`zitadel setup` and `zitadel doctor` now require Next.js 15.2.3 or later. Next.js 15.0.0 to 15.2.2
skip middleware for a request that sends an `x-middleware-subrequest` header (CVE-2025-29927), so
on those versions anyone could reach a page that `protectedRoutes` guards. A version that can only
resolve below 15.2.3, such as `15.2.2` or `~15.1.0`, is refused with `E_UNSUPPORTED_PROJECT_SHAPE`;
a range such as `^15.0.0` is accepted, so make sure your lockfile installs 15.2.3 or later.
