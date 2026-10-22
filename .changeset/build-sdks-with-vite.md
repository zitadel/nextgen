---
"@zitadel/sdk-core": patch
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

The SDKs now ship unminified ES modules with source maps, so stack traces and debuggers point at the SDK's own source. Their exports, types and behavior are unchanged.
