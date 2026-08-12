# CLI Journey E2E Instructions

These instructions apply to `apps/cli-journey-e2e/**`. Defer to the root
`AGENTS.md` for repository-wide rules.

## Purpose

This project protects the customer local setup journey across every supported
CLI framework. Tests must exercise a fresh app directory that runs the CLI local
runtime path (`doctor`, `start`, `setup --server local`) before starting the
generated app. It must not test the checked-in demo apps. The fresh directory
starts empty (setup scaffolds the skeleton, page posture) or seeded from
`fixtures/preexisting/<framework>` (`--preexisting-app`, widget posture per
ADR 044) — both shapes run the same CLI path and browser journeys.

## Maintenance Rules

- Keep generated apps and temporary registries outside the repo worktree.
- Use `npm` inside the generated app to match the documented user path.
- Use `moon run release:pack` when producing workspace tarballs; it stages the
  server platform binaries, packs all public packages, and verifies resolved
  package metadata.
- CI may pass prebuilt release snapshot tarballs to the journey runner with
  `--tarballs-dir`; that path must skip rebuilding and still verify/publish the
  provided tarballs through Verdaccio.
- CI must install Zitadel packages from current workflow tarballs through the
  temporary Verdaccio registry, not from public npm.
- CI must run `npx @zitadel/cli@alpha doctor --runtime binary`,
  `start --runtime binary`, and
  `setup --framework <next|nuxt|react|vue|angular|solid|svelte|qwik> --server local`
  from the fresh app directory with `--non-interactive --json`.
- Docker fallback coverage must opt in with `--runtime docker --image <tag>`.
- Pack and upload only the public packages — `PUBLIC_RELEASE_PACKAGES` in
  `scripts/release-manifest.mjs` is the authoritative list, and
  `verify-tarballs.mjs` enforces that both the journey registry and release
  artifact dirs carry exactly that set. Private support packages must stay out
  of the artifact set.
- Keep the generated app on `localhost` for browser tests. WebAuthn rejects IP
  address relying-party IDs such as `127.0.0.1`.
- The pre-existing-app fixtures (`fixtures/preexisting/<framework>`) must stay
  minimal but real: exactly detectable by the CLI (ADR 044's posture hinge),
  bootable via `npm run dev`, and carrying a distinctive shell and homepage the
  specs assert survive setup. Only route-based frameworks (Next, Nuxt) belong
  here — the SPA families keep the page posture.
- The testkit suite (`--suite testkit`, moon task `e2e-testkit`) is the
  customer-configuration proof for `@zitadel/testing`: it scaffolds one next
  app, installs the kit from the journey registry, copies the checked-in
  consumer suite from `fixtures/testkit/`, and runs it inside the app. It must
  never set `ZITADEL_SERVER_BINARY` or `NEXTGEN_*` env — proving that the
  published binary and its embedded UIs work unconfigured is the point.
- Keep each framework suite Playwright-serial and one-worker. Framework suites
  may run in parallel only when each suite gets its own generated app directory,
  npm cache/tmp directories, app port, Zitadel port, and backend runtime state.
- Reserve runner ports through the block allocator in `scripts/ports.mjs`,
  never via a listen-on-zero probe: reserved ports are bound minutes later, and
  ephemeral-range ports get taken as outbound source ports by the parallel
  suites' npm traffic in the meantime (the why and the block layout are
  documented in that file).
- Passkey coverage is required in CI. `JOURNEY_ENABLE_PASSKEY=0` is only a local
  debugging escape hatch.
- Keep diagnostics focused. Upload logs, setup JSON, lockfiles, Playwright
  traces/reports, and metadata; do not upload generated `node_modules` or
  `.next` directories.
