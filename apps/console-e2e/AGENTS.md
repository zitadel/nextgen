# Agent Instructions — `apps/console-e2e`

Playwright project for the console's three runtime boundaries. Defer to root
[`AGENTS.md`](../../AGENTS.md) for repo-wide rules; lane descriptions and the
secret-handling caveat live in [`README.md`](README.md).

## The three lanes

- `moon run console-e2e:e2e` — **embedded shell smoke**: Vite-preview of the
  built console under its production embed base `/ui/console/`. No live API.
- `moon run console-e2e:e2e-real` — **real-instance resource coverage**: one
  ephemeral real instance via `@zitadel/testing`
  ([`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md)), console
  served by the Vite dev server with the server-side project-secret proxy,
  Playwright workers share the instance and seed a fresh user per test.
- `moon run console-e2e:e2e-embedded` — **embedded production-path coverage**:
  the built Go binary serves the console, hosted login, and API from one
  origin, with no Vite proxy. This is the only lane that proves the API base
  and Go mux agree on the request path customers receive.

All three tasks carry `runInCI: false` — that only keeps them out of moon's
automatic selection. The `full-pr` job explicitly runs `e2e-real` and
`e2e-embedded` in separate, sequential workflow steps; the shell smoke stays
local-only. The `@zitadel/testing` interaction is documented in
[`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md).

## Hard rules

- **Port pinning**: `REAL_ZITADEL_PORT: 8093` and
  `EMBEDDED_ZITADEL_PORT: 8095` are fixed pins deliberately outside the
  deferred-bind blocks — the full doctrine (why config-time ports cannot live
  in the dynamically scanned reservation domains, and the neighbor map) is in
  [`moon.yml`](moon.yml) and `apps/cli-journey-e2e/scripts/ports.mjs`. Do not
  move either lane onto a scanned block, and sweep orphans with
  `moon run workspace:cli -- stop --all`.
- **Secrets**: the `.zitadel-testing/` handshake contains the project secret —
  gitignored, never uploaded as a CI artifact. Failure artifacts are limited
  to Playwright results and the HTML report.
- **Test placement**: this project covers only console runtime boundaries
  (embed base, dev proxy, live resource data, binary-served production path).
  Screen behavior belongs in `apps/console` Vitest specs
  (`src/routes/**/*.spec.tsx`); component behavior in the component packages —
  same layering rule as root `AGENTS.md` Testing Layers.
