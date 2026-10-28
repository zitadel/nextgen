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

The SDKs now ship minified ES modules with a source map beside each, so stack traces and debuggers still point at the SDK's own source. The SvelteKit, Qwik Router, SolidStart and TanStack Start SDKs now ship one declaration file per source file instead of one bundled file per entry. Their exports, the types they name and their behavior are unchanged, except that `@zitadel/sdk-angular` now ships its entry as `dist/public-api.js` (was `dist/index.js`) and its types as `dist/public-api.d.ts` (was `dist/types/public-api.d.ts`), so a deep import of either path moves.
