# Agent Instructions — `e2e/console`

The console's runtime boundaries, the part its Vitest specs cannot reach. Lane
details and secret handling: [`README.md`](README.md).

## Lanes

- `moon run e2e:console-smoke`: the built console in Vite preview under its
  embed base `/ui/console/`, with no API.
- `moon run e2e:console-real`: one real instance through `@zitadel/testing`,
  the console on the Vite dev server behind its credential-free proxy. Each
  test grants and signs in its own user (`signIn` in `support/sign-in.ts`).
- `moon run e2e:console-embedded`: the built Go binary serves the console,
  the login and the API from one origin. The only lane that proves the API
  base and the Go mux agree on the path customers receive.
- `moon run e2e:console-platform`: the same binary with the platform project
  bootstrapped, as `zitadel start` (and so `@zitadel/testing`) does by
  default; the server alone leaves it off (`platform.bootstrap_project`). An
  operator works in a granted project other than the one the console signs
  into.
- `moon run e2e:console-deployment`: checks the hosted-cloud deployment
  `CLOUD_URL` names. It holds only `VERCEL_AUTOMATION_BYPASS_SECRET`, so it
  records no traces and no HTML report. `pnpm check:cloud` runs it with the
  docs and schemas deployment suites; `deployment-checks.yml` runs it for
  every deployment.

How the other four run in CI and locally:
[`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md#moon-and-the-e2e-lanes).

## Rules

- Cover only runtime boundaries (embed base, dev proxy, live data, the
  binary-served path, the cloud's routing). Screen behaviour belongs in
  `apps/console`'s specs (`src/routes/**/*.spec.tsx`), component behaviour in
  the component packages.
- Screens act on the selected project (`?project=`). The guard selects only a
  project the person holds a grant on, and no lane pins the project the
  console signs into: it comes from the instance's `/console/runtime.json`. A
  spec that navigates by URL lets the guard fill in `?project=` or names it.
- `REAL_ZITADEL_PORT`, `EMBEDDED_ZITADEL_PORT` and `PLATFORM_ZITADEL_PORT` are
  fixed pins outside the scanned port blocks (why: the lane configs and
  [`../journey/scripts/ports.mjs`](../journey/scripts/ports.mjs)). Never move
  a lane onto a scanned block.
- The `.zitadel-testing/` handshake holds the project secret: keep it
  gitignored and never upload it. Failure artifacts are only the Playwright
  results and the HTML report.
- Put helpers more than one spec uses in `support/`. `support/runtime.ts`
  imports only `@playwright/test`, because the smoke lane builds no test kit;
  `support/copy.ts` imports nothing, because the journey's claim suite reads
  it.
