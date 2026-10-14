---
"@zitadel/sdk-core": minor
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-solid-start": major
"@zitadel/sdk-qwik-city": major
"@zitadel/sdk-tanstack-start": major
---

`ClientSession`, `ClientAuthState` and `ClientAuthResult` are now the sdk-core types in every
server SDK and are exported from each package root. SolidStart, Qwik City and TanStack Start
replace their outdated `email` and `name` fields with `identifier`, `identifierProperty` and
`display`, the fields `getAuth()` actually returns: read `display ?? identifier` where you read
`name ?? email`.
