---
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
---

Refuse a request with a 400 when the client-sent `x-nextgen-auth-token` header cannot be removed, instead of letting it reach the app, matching the Qwik City and TanStack Start SDKs.
