# console

Pre-release Vite + React shell for the internal Zitadel console — where users
will manage their account and settings. Built with `@zitadel/ui-react` atoms
and design tokens, and embedded into the Go server under `/ui/console/`.

Architecture decisions for this app are recorded in
[`docs/adrs/`](docs/adrs/README.md): routing ([ADR 0001](docs/adrs/0001-console-routing.md))
and API access ([ADR 0002](docs/adrs/0002-console-api-access.md)).

Component development and review (atoms, paired React, and the
`<zitadel-login>` orchestrator) live in
[`apps/storybook`](../storybook/README.md), not in this app.

## Styling

Design tokens are the source of truth; Tailwind is the convenience layer that
exposes them as utilities (`bg-zl-surface-default-black`, …). The approach is
decided by **where the file lives**, not by guessing future reuse: everything
under `apps/console/**` uses Tailwind utilities and never a bespoke CSS file,
while the shared design-system primitives in `packages/components` /
`packages/ui-react` (e.g. `Button`) use the shared token CSS, because utilities
can't reach a custom element's shadow DOM. Full rules and the decision tree:
[`docs/styling.md`](docs/styling.md).

## API access and auth

The console holds **no long-lived credential in the browser bundle**. It calls a
same-origin API base (`/api` by default), and a server-side proxy attaches the
`Authorization: Bearer` token before forwarding to the API, so no secret reaches
the browser (see [ADR 0002](docs/adrs/0002-console-api-access.md)). Attaching the
bearer is the console proxy's responsibility, mirroring the Zitadel client SDKs.

The bearer is currently a **project secret**, injected by the Vite dev proxy from
a Node-only env var (see [Environment variables](#environment-variables)). A user
login flow will replace it: after authentication the console forwards the session
cookie as the bearer and the project secret is retired. The production proxy
runtime and the permissions model are defined in a future ADR.

### Environment variables

| Variable                  | Scope            | Purpose                                                                 |
| ------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `VITE_CONSOLE_PROJECT_ID` | public (browser) | Non-secret project id; scopes list/detail calls that need `project_id`. |
| `VITE_CONSOLE_API_BASE`   | public (browser) | Same-origin API base path. Defaults to `/api`.                          |
| `CONSOLE_PROJECT_SECRET`  | **Node only**    | Interim project-secret bearer injected by the dev proxy. Not `VITE_`-prefixed, so it never reaches the browser bundle. |
| `VITE_CONSOLE_BACKEND_URL`| Node (dev proxy) | Go server URL the dev proxy forwards to. Defaults to `http://localhost:8080`. |

## Run against the Go server

Start a Go server from source (repo root, after `corepack pnpm install`) — it
builds and embeds the console, boots embedded Postgres, and listens on `:8080`:

```bash
moon run workspace:server
```

Create a project to get an id and bearer secret (`POST /projects` is
unauthenticated):

```bash
curl -sS -X POST http://localhost:8080/projects \
  -H 'Content-Type: application/json' \
  -d '{"previewOrigins":["http://localhost:5174"]}'
# → { "id": "proj_…", "projectSecret": "…", … }
```

### Frontend dev — Vite with HMR (port 5174)

The day-to-day frontend loop: hot reload, with the dev proxy injecting the
secret so list/detail pages hit the live Go API.

```bash
export VITE_CONSOLE_PROJECT_ID=<id>
export CONSOLE_PROJECT_SECRET=<projectSecret>
moon run console:dev
```

Open [http://localhost:5174](http://localhost:5174).

### Full build — the binary (port 8080)

The Go binary embeds and serves the console SPA. `moon run workspace:server`
rebuilds and embeds the console, so the full build is simply that command — then
open the embedded path:

[http://localhost:8080/ui/console/](http://localhost:8080/ui/console/)

> **Live data is not available from the binary.** The binary serves the console
> shell and routing, but `/api` calls from `:8080/ui/console` carry no bearer —
> that requires the server-side proxy, which only the Vite dev server provides.
> Resource pages therefore hit the error boundary; use the dev server above for
> live data. The production proxy runtime is defined in a future ADR (see
> [API access and auth](#api-access-and-auth)).
>
> A fresh project also has no data, so list pages show their empty state until
> you create users/sessions/flow-definitions against that project.

## Other tasks

```bash
moon run console:typecheck
moon run console:test
moon run console:build
```
