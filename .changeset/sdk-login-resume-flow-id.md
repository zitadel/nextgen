---
"@zitadel/components": patch
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
---

Every SDK's `ZitadelLogin` now takes `resumeFlowId`, documented in its README, so a page can resume an existing sign-in flow (for example one kept across a reload) without reaching for the element. Clearing it, or passing `null` or an empty string, on `<zitadel-login>` now means "no handle" in every framework, which falls back to the `flow` query parameter as before.
