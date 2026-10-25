---
"@zitadel/sdk-core": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-qwik-router": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-tanstack-start": patch
---

The SDKs now ship source maps (only `@zitadel/sdk-core` did before), and the React, Vue, Solid, Svelte, Qwik and Angular SDKs no longer minify their ES modules, so stack traces and debuggers point at the SDK's own source. Their exports, types and behavior are unchanged, except that `@zitadel/sdk-angular` now ships its entry as `dist/public-api.js` and its types as `dist/public-api.d.ts`, so a deep import of `dist/types/public-api.d.ts` moves.
