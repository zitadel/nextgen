---
"@zitadel/components": patch
"@zitadel/config": patch
"@zitadel/testing": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-qwik-router": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-tanstack-start": patch
"@zitadel/sdk-vue": patch
---

The packages no longer ship `.d.ts.map` files. They pointed at `src` files the packages do not publish, so an editor's go-to-definition already landed on the `.d.ts`; it still does.
