---
applyTo: "apps/cli-journey-e2e/**,.github/workflows/ci.yml"
---

# Consumer Journey Review Instructions

Review consumer journey changes as the required customer local setup quality
gate, not as a demo-app e2e suite. The canonical contract is
[`apps/cli-journey-e2e/AGENTS.md`](../../apps/cli-journey-e2e/AGENTS.md) —
tarball packing (`moon run release:pack`), the `PUBLIC_RELEASE_PACKAGES`
manifest + `verify-tarballs.mjs` enforcement, the 8-framework matrix, the
four CI-gated journey variants (`journey_fresh_app`, `journey_passkey`,
`journey_preexisting`, `journey_testkit`) with `JOURNEY_MATRIX` collapsing,
port doctrine, and WebAuthn/`localhost` rules all live there. Review pointers
on top of it:

- CI must install Zitadel packages from current workflow tarballs through the
  temporary Verdaccio registry, never from public npm. The local-runtime image
  is built by `scripts/build-local-runtime-image.mjs` /
  `moon run release:snapshot` (GoReleaser is retired — root `AGENTS.md`).
- The journey exercises the customer path through `npx`: `doctor`, `start`,
  then `setup --framework <one of the 8> --server local` with
  `--non-interactive --json`, generated apps outside the repo, `npm` inside
  the generated app.
- Keep Verdaccio proxying npmjs for third-party dependencies while publishing
  Zitadel tarballs under both `alpha` and `latest`.
- Preserve the CLI setup JSON contract: `--non-interactive --json` must parse
  from stdout and return `status: "ok"`.
- Passkey coverage is required in CI; `JOURNEY_ENABLE_PASSKEY=0` is a local
  debugging escape hatch only.
- Failure artifacts include Playwright output/report, doctor/start/setup JSON
  and stderr, runtime metadata/logs, generated app manifests, and Verdaccio
  logs — never generated `node_modules` or `.next`.
