---
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-qwik": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The SDK READMEs now say that the session card does not go to its `postSignOutUrl` when there is no session and that URL is the page it is on: it renders nothing instead, so it is no guard on its own sign-out page.
