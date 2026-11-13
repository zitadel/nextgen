---
"@zitadel/cli": minor
---

`zitadel setup` no longer writes your project's id into an Angular app's `src/app/app.ts`. The component reads `ZITADEL_PROJECT_ID`, which a new `zitadel-ng.cjs` defines when it runs the Angular CLI, from the environment or from `.env.local`. Setup runs your serve and build scripts through it, so the app and its dev proxy always use the same project, and a plain `ng serve` or `ng build` stops with a message saying to run `npm run dev` or `npm run build`. `zitadel doctor` reports an app that an earlier setup wrote, and `zitadel doctor --fix` moves it over; a serve or build script you changed yourself is named in `doctor`'s warning with what to run instead.

**Breaking:** once `doctor --fix` has moved an Angular app, build it with `npm run build` and set `ZITADEL_PROJECT_ID` in the environment on any build machine without `.env.local`. A plain `ng build` now stops with that message.
