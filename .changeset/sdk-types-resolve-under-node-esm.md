---
"@zitadel/components": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-vue": patch
---

The published TypeScript types now resolve under strict Node ESM resolution (`node16` and `nodenext`): the React, Vue, Solid, Svelte, Qwik and Angular SDKs spell out explicit file extensions in their declarations. The Qwik SDK no longer ships a test-only declaration file. `@zitadel/components` exports `defaultTemplate` and `layoutChromeCss` as plain `string` values, so its declarations no longer import a compiled chunk that has no types.
