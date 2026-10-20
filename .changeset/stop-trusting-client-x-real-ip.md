---
"@zitadel/sdk-next": patch
"@zitadel/sdk-tanstack-start": patch
---

The Next.js and TanStack Start proxies no longer take the client address from a request's own `x-real-ip` header, which any caller could set. The address appended to `X-Forwarded-For` now comes only from what the runtime provides, as it already does in the other server SDKs.
