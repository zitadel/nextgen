---
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

The README and Agent Skill install commands now name the `@alpha` dist-tag
(`pnpm add @zitadel/sdk-next@alpha`). Without it, npm installs an old preview from `latest`
instead of the current release.
