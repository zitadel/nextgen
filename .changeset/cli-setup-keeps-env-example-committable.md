---
"@zitadel/cli": patch
---

`zitadel setup` no longer leaves `.env.example` git-ignored in SvelteKit, Nuxt and SolidStart apps, and `zitadel doctor --fix` un-ignores it in apps an earlier setup left that way.
