# Agent Instructions — `apps/cloud-console`

The hosted cloud's add-on to the console: what only the cloud's console build
carries ([Console ADR 0006](../console/docs/adrs/0006-cloud-addon.md)). The
cloud's `console` service compiles it in through `CONSOLE_ADDON` (repo-root
[`vercel.json`](../../vercel.json)); the console the Go server embeds never
contains it.

- From the console, import only `@zitadel/console/addon` (the contract) and
  `@zitadel/console/addon/ui` (the component kit); never its source (`@/…`) or
  a relative path into it.
- Need a slot or a component? Add it to `apps/console/src/addon/contract.ts`
  (optional) or `ui.ts` in the same change.
- Read a build setting from `import.meta.env` only once `vite.ts` inlines it,
  and declare it in `src/vite-env.d.ts`.
- Call the cloud's backend only through `src/cloud-api.ts`, with the shapes of
  `@zitadel/cloud-functions/contract`
  ([cloud-functions](../cloud-functions/AGENTS.md)).
- Keep what is not live yet out of production builds (`unreleased` in
  `src/index.ts`, root ADR 083 §9).
- Nothing builds here. The console's build with the add-on, as the cloud makes
  it, forced because the add-on's files are no inputs of that build:

  ```sh
  CONSOLE_ADDON=../cloud-console CONSOLE_BASE_PATH=/console/ moon run --force console:build
  ```

- Run the screens locally with the console's dev server and the functions'
  side by side; the add-on's dev proxy sends `/cloud/` to the second:

  ```sh
  moon run cloud-functions:dev
  CONSOLE_ADDON=../cloud-console moon run console:dev-real
  ```

- That `dev-real` also builds the console its server embeds with the add-on
  in; the next build without `CONSOLE_ADDON` restores the embedded one.
