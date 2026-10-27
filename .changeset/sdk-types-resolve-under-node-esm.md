---
"@zitadel/components": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-vue": patch
---

The React, Vue, Solid, Svelte, Qwik and Angular SDKs' published types now resolve under strict Node ESM resolution (`node16` and `nodenext`), and `@zitadel/components` exports `defaultTemplate` and `layoutChromeCss` as plain strings, so its declarations import no chunk without types.
