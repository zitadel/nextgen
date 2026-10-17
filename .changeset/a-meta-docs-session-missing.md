---
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The READMEs document the session widgets' session-missing callback and the session card's redirect
to its `postSignOutUrl` when it finds no session. In Nuxt, whose templates use the raw elements, the
README and Agent Skill show it as `@zitadel-session-missing`.
