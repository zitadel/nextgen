---
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

Add an Agent Skill for each of the SvelteKit, SolidStart, Qwik City and TanStack Start SDKs, and route to them from the top-level `zitadel` skill. Like the other per-framework skills they are distributed through the repo, not npm, and each teaches the integration pattern while pointing at the installed package's README and types for exact APIs.
