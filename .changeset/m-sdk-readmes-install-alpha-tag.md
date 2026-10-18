---
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-qwik": patch
"@zitadel/components": patch
---

The README and Agent Skill install commands now name the `@alpha` dist-tag (`pnpm add @zitadel/sdk-react@alpha`). Without it, npm installs an old preview from `latest` instead of the current release.
