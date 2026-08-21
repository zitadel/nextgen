---
"@zitadel/cli": patch
---

Scaffolded Nuxt projects no longer list `@zitadel/ui-react` in `build.transpile`. The package is gone, so writing it into a user's `nuxt.config.ts` left them with a config entry pointing at a dependency they do not have.
