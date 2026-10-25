---
"@zitadel/components": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-vue": patch
---

The published TypeScript types now resolve under strict Node ESM resolution (`node16` and `nodenext`). The React, Qwik and Vue SDKs ship their declarations as a single file, the Angular SDK points its `types` at a bundled `dist/index.d.ts`, and the Solid and Svelte SDKs spell out explicit file extensions in their declarations. The Qwik SDK no longer ships a test-only declaration file. `@zitadel/components` exports `defaultTemplate` and `layoutChromeCss` as plain `string` values, so its declarations no longer import a compiled chunk that has no types.
