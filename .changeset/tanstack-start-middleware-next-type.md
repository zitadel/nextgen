---
"@zitadel/sdk-tanstack-start": patch
---

`createNextgenRequestMiddleware` now type-checks inside `createMiddleware({ type: "request" }).server(...)`. Its context type said `next()` always returns a promise, while TanStack Start types it as returning its result with or without one, so `tsc` rejected the `src/start.ts` that `zitadel setup` writes with TS2345. The middleware already awaited the result, so only the type changes.
