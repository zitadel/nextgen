---
"@zitadel/cli": patch
---

`zitadel setup` creates Nuxt, Angular, SvelteKit, SolidStart and TanStack Start apps with a tested release of each framework's CLI, and Nuxt apps from a fixed copy of the Nuxt starter, instead of whatever was released last, so a broken upstream release no longer breaks setup on the day it ships.
