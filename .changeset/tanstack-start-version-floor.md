---
"@zitadel/sdk-tanstack-start": patch
---

The `@tanstack/react-start` peer range is now `>=1.168.10`, the first release that exports `createCsrfMiddleware`, which the generated `src/start.ts` imports. Earlier releases fail to build with it.
