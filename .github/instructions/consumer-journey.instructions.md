---
applyTo: "apps/cli-journey-e2e/**,.github/workflows/ci.yml"
---

# Consumer Journey Review Instructions

Review consumer journey changes as a required fresh-app quality gate, not as a
demo-app e2e suite.

- CI must consume the current workflow's GoReleaser image and npm package
  tarballs. Do not replace this with public npm packages for Zitadel packages.
- Produce package artifacts with `corepack pnpm --dir <package> pack` and keep
  tarball verification for required package presence plus unresolved
  `catalog:` or `workspace:` dependency specs.
- Pack only the public Zitadel packages. Private support packages such as
  design tokens must not be uploaded or published to Verdaccio.
- Keep Verdaccio proxying npmjs for third-party dependencies while publishing
  Zitadel tarballs under both `alpha` and `latest`.
- Keep generated Next.js apps outside the repo and use `npm` inside the
  generated app to match the documented consumer path.
- Preserve the CLI setup JSON contract: `--non-interactive --json` must parse
  from stdout and return `status: "ok"`.
- Browser tests should run serially with one worker, use `localhost` for
  WebAuthn, and require passkey coverage in CI. `JOURNEY_ENABLE_PASSKEY=0` is
  only a local debugging escape hatch.
- Failure artifacts should include Playwright output/report, setup JSON,
  setup stderr, metadata, generated app package manifests, Verdaccio logs, Next
  logs, and backend logs. Do not upload generated `node_modules` or `.next`.
