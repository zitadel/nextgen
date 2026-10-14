---
"@zitadel/sdk-core": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

`ClientSession`, `ClientAuthState` and `ClientAuthResult` are now the sdk-core types in every
server SDK and are exported from each package root. SolidStart, Qwik City and TanStack Start
replace their outdated `email` and `name` fields with `identifier`, `identifierProperty` and
`display`, the fields `getAuth()` actually returns.
