---
"@zitadel/cli": patch
---

`zitadel setup` no longer writes your project's ID into an Angular app's `src/app/app.ts`. The app imports it from a git-ignored `src/app/zitadel-project.ts`, which `zitadel-ng.cjs` writes from `ZITADEL_PROJECT_ID` (environment or `.env.local`) when your `npm run dev`, `build` and `test` scripts run `ng`. Build with `npm run build`, not `ng build`.
