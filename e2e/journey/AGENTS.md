# Agent Instructions — `e2e/journey`

The customer's local setup journey, for every CLI framework: a fresh app
directory runs `doctor`, `start` and `setup --server local`, then starts the
generated app. Never test the checked-in demo apps here. Paths below are from
the repo root.

## The journey

- CI runs `npx @zitadel/cli@latest doctor --runtime binary`,
  `start --runtime binary` and `setup --framework <id> --server local`, each
  with `--non-interactive --json`, for every id in `ciFrameworkIds`
  (`e2e/journey/scripts/frameworks.mjs`). The ids in `ciExcludedFrameworkIds`
  run only by hand (`--framework <id>`).
- The fresh directory starts empty (page posture) or from
  `e2e/journey/fixtures/preexisting/<framework>` (`--preexisting-app`, widget
  posture, ADR 044); both run the same CLI path and browser journeys.
- Keep each pre-existing fixture minimal but real: detectable by the CLI,
  bootable with `npm run dev`, with a distinctive shell and homepage the specs
  assert survive setup. Only route-based frameworks (Next, Nuxt) get one; the
  SPA families keep the page posture.
- Use `npm` in the generated app, as the documented path does.
- Keep generated apps and temporary registries outside the worktree, and the
  app on `localhost`: WebAuthn rejects IP relying-party IDs.
- The remote https lane (`--remote`) is the one exception to `--server local`:
  setup points at `e2e/journey/scripts/https-edge.mjs`, a local https edge for
  `zitadel.test` that, like Vercel's, completes TLS only for its own name,
  routes by `Host` and overwrites `X-Forwarded-*`.
- Docker fallback coverage opts in with `--runtime docker --image <tag>`.
- Passkey coverage is required in CI and rides the `passkey-first` preset
  lane, because the shipped `password-first` flow offers no passkey.
  `JOURNEY_ENABLE_PASSKEY=0` is a local debugging escape hatch only.
- The testkit suite (`turbo run journey --filter=@zitadel/e2e -- --suite testkit`) installs
  `@zitadel/testing` from the journey registry into one Next app and runs the
  consumer suite in `e2e/journey/fixtures/testkit/`. It never sets
  `ZITADEL_SERVER_BINARY` or `NEXTGEN_*`: proving the published binary works
  unconfigured is the point.
- Skip a spec that needs the mock OIDC provider when `JOURNEY_OIDC_MOCK_URL`
  is unset: lanes on `--runtime docker` or without a built mock start none.

## Packages and the registry

- Install `@zitadel/*` from the workflow's tarballs through the temporary
  Verdaccio registry, never from public npm.
- Produce tarballs with `turbo run pack --filter=@zitadel/release`, which
  packs every public package with the server binaries the graph built.
  `--tarballs-dir` hands prebuilt ones to the runner, which skips building
  but still verifies and publishes them.
- The CI journeys (`journey:<id>`, `--packed`) install only what they need
  (`journeyPackageDirs`, `e2e/journey/scripts/journey-packages.mjs`) from the
  builds their task depends on: the `journey-packages` task packs what every
  CI journey installs once per run, and a `journey:<id>` task copies those
  and packs the rest (run any other way, `--packed` packs it all); by hand,
  `turbo run journey --filter=@zitadel/e2e -- --ci` packs the release set.
- Publish to the journey registry with `publish-tarballs.mjs`'s own request,
  not `npm publish`: an npm process per package costs seconds each.
- Give a journey task an edge to the build of every package it installs, in
  `e2e/turbo.json`; `frameworks.test.mjs` checks them against the manifests.
- Pack and upload only `PUBLIC_RELEASE_PACKAGES`
  (`scripts/release-manifest.mjs`); `e2e/journey/scripts/verify-tarballs.mjs`
  enforces the set: the full one for `@zitadel/release#pack`, the journey's
  own with `--packages`.
- The `journey:<id>` tasks are cached, so run nothing whose version the repo
  does not fix: the CLI runs each framework CLI at its pin
  ([cli](../../apps/cli/AGENTS.md)); only the npm ranges those write resolve
  at run time.

## The runner

- Add a CI journey to `ciJourneyVariants` (`frameworks.mjs`) and give it a
  `journey:<id>` task under `journey-local` and in the root `ci` script
  (so `--affected` can skip it); `frameworks.test.mjs` fails
  until it has one. Never a workflow step.
- Every option CI sets has a `JOURNEY_*` variable (`journeyArgsFromEnv` in
  `e2e/journey/scripts/run-options.mjs`): turbo puts arguments after `--` into
  every task's cache key.
- `JOURNEY_*` is in the cached journeys' key; exclude a variable that only
  moves where a run writes, as `!JOURNEY_WORK_DIR` (`e2e/turbo.json`).
- Keep each framework suite Playwright-serial with one worker. Suites run in
  parallel only with their own app directory, npm cache and tmp directories,
  app port, Zitadel port and runtime state.
- Reserve ports through the block allocator in
  `e2e/journey/scripts/ports.mjs`, never a listen-on-zero probe: a port
  reserved minutes before use gets taken as an outbound source port meanwhile.
- Time every step that takes seconds with `timePhase` and add its phase to
  `PHASES` (`e2e/journey/scripts/timings.mjs`): the lane × phase table in the
  job summary is how a slow lane is found.
- Upload logs, setup JSON, lockfiles, Playwright traces and reports and
  metadata; never generated `node_modules` or `.next` directories.
