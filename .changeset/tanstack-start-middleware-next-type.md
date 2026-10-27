---
"@zitadel/sdk-tanstack-start": patch
---

`createNextgenRequestMiddleware` now type-checks inside `createMiddleware({ type: "request" }).server(...)`, so `tsc` no longer rejects the `src/start.ts` that `zitadel setup` writes with TS2345.
