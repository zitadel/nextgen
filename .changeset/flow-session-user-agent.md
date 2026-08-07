---
"@zitadel/server": patch
---

Sessions created by the login flow now record the request's device context (the
`User-Agent` header and client IP), so flow-originated sessions no longer show
blank device info. The user agent is captured at flow start and survives the
handoff exchange; supplying an existing session leaves its user agent untouched.
