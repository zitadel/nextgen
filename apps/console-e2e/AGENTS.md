# Agent Instructions — `apps/console-e2e`

Playwright project for the console's two runtime boundaries. Defer to root
[`AGENTS.md`](../../AGENTS.md) for repo-wide rules; lane descriptions and the
secret-handling caveat live in [`README.md`](README.md).

## The two lanes

- `moon run console-e2e:e2e` — **embedded shell smoke**: Vite-preview of the
  built console under its production embed base `/ui/console/`. No live API.
- `moon run console-e2e:e2e-real` — **real-instance resource coverage**: one
  ephemeral real instance via `@zitadel/testing`
  ([`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md)), console
  served by the Vite dev server with the server-side project-secret proxy,
  Playwright workers share the instance and seed a fresh user per test.

Both lanes carry `runInCI: false` — that only keeps them out of moon's
automatic selection; the `full-pr` job runs `e2e-real` through an explicit
workflow step (the canonical statement of that interaction is in
`packages/testing/AGENTS.md`).

## Hard rules

- **Port pinning**: `REAL_ZITADEL_PORT: 8093` is a fixed pin deliberately
  outside the deferred-bind blocks — the full doctrine (why config-time ports
  cannot live in the dynamically scanned reservation domains, and the
  neighbor map) is the comment in [`moon.yml`](moon.yml) and
  `apps/cli-journey-e2e/scripts/ports.mjs`. Do not move this lane onto a
  scanned block, and sweep orphans with
  `moon run workspace:cli -- stop --all`.
- **Secrets**: the `.zitadel-testing/` handshake contains the project secret —
  gitignored, never uploaded as a CI artifact. Failure artifacts are limited
  to Playwright results and the HTML report.
- **Test placement**: this project covers only what needs the real console
  runtime boundary (embed base, proxy, live resource data). Screen behavior
  belongs in `apps/console` Vitest specs (`src/routes/**/*.spec.tsx`);
  component behavior in the component packages — same layering rule as root
  `AGENTS.md` Testing Layers.
