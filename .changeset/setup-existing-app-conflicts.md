---
"@zitadel/cli": patch
---

`zitadel setup` now stops with `E_CONFLICT`, before it creates a project, in existing apps it used to leave broken while reporting success: an app that mounts its root component from a file other than the one setup writes, such as `src/App.jsx` or Angular 17–19's `src/app/app.component.ts`; a Next.js app whose own `middleware.ts` would sit beside the `proxy.ts` setup writes for Next 16, which Next refuses to run; and a `--framework` other than the app's, where `--force` used to scaffold a new app over it. The error's hint says what to change, since `--force` can't fix these. Setup also checks the schema, flow and connection files it writes to `.zitadel/` before it creates the project, so a conflict there no longer leaves a project behind whose id and secret a rerun kept in `.env.local`.
