---
"@zitadel/components": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-vue": patch
---

The published TypeScript types now resolve under strict Node ESM resolution (`node16` and `nodenext`). The React, Solid, Qwik and Vue SDKs ship their declarations as a single file, the Angular SDK points its `types` at a bundled `dist/index.d.ts`, and the Svelte SDK spells out explicit file extensions in its declarations. `@zitadel/components` exports `layoutChromeCss` as a plain `string`.
