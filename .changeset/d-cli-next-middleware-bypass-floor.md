---
"@zitadel/cli": minor
---

`zitadel setup` and `zitadel doctor` now require Next.js 15.2.3 or later. Next.js 15.0.0 to 15.2.2
skip middleware for a request that sends an `x-middleware-subrequest` header (CVE-2025-29927), so
on those versions anyone could reach a page that `protectedRoutes` guards. A version that can only
resolve below 15.2.3, such as `15.2.2` or `~15.1.0`, is refused with `E_UNSUPPORTED_PROJECT_SHAPE`,
and so is an app whose installed Next.js is older than 15.2.3 even when its range, such as
`^15.0.0`, allows a fixed release. Upgrade Next.js and reinstall, then rerun the command.
