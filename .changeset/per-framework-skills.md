---
"@zitadel/sdk-next": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-qwik": minor
"@zitadel/components": minor
---

Ship a per-framework Agent Skill inside each SDK package and `@zitadel/components`, alongside a top-level `zitadel` router skill that routes to the right one. A single `npx skills add zitadel/nextgen` now gives a coding agent framework-specific guidance for integrating Zitadel auth into a React, Next.js, Angular, Nuxt, Vue, Solid, Svelte, or Qwik app — including existing apps the CLI can't scaffold — and for embedding the `<zitadel-login>` web component directly. Each skill is discover-first: it teaches the integration pattern and points at the installed package's own README and types for exact APIs, so it does not drift with the package version.
