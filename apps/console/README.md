# console

Pre-release Vite + React shell for the internal Zitadel console — where users
will manage their account and settings. Built with **shadcn/ui** and
`@zitadel/design-tokens` (`css/shadcn.css`), and embedded into the Go server
under `/ui/console/`.

Architecture decisions for this app are recorded in the repo-wide
[`docs/adrs/`](../../docs/adrs/README.md) index.

Login / shared atom development lives in
[`apps/storybook`](../storybook/README.md), not in this app.

## Styling

The console is a **shadcn/ui** app. Components are installed into
`src/components/ui/` via `components.json`. Colours, type, and radius come from
`@zitadel/design-tokens/css/shadcn.css`, which maps standard shadcn utility names
(`bg-background`, `text-muted-foreground`, …) onto `--zl-*` variables. Full
rules and the Figma → code flow: [`docs/styling.md`](docs/styling.md).

## Theming

The console follows the OS colour scheme by default and offers a Light / Dark /
System toggle in the context bar (persisted in `localStorage`). Theming is
driven by `data-theme` on `<html>`: the design tokens ship a dark `:root` and a
light `[data-theme="light"]` override, so components only reference semantic
tokens and re-theme automatically. See [`src/theme.ts`](src/theme.ts) and the
pre-paint script in [`index.html`](index.html).

## Screen coverage (built vs. designed)

The Figma handoff (`j3qqriDab6WQfrlgLujf4Y`, Vega) currently designs the
**Users** screen (desktop + mobile) and the **Sidebar 08. / Sidebar 07.** chrome.
Other destinations have no screen design and, mostly, no API yet.

**Built and in the sidebar:**

- **Users** — Figma Users screen (shadcn `Table` / `Tabs` / …), static mock data
  until the user-management API lands. Desktop + mobile (`Dashboard xs`) layouts.
- **Sessions**, **Projects** — list pages still on shared `resource-page`
  helpers; migrating to shadcn as designs land.
- **Home** (`/`) — static General mock, reached via the sidebar logo (no nav
  row). Being replaced when a home design ships.

**Designed sidebar IA not yet built (backlog):** App groups, Applications,
Analytics, Activity Log (shown as disabled rows). Add each when its design and
API exist — attaching `staticData.nav` to the new route re-lists it.

## Shell

`AppShell` is shadcn's `Sidebar` block (`collapsible="icon"`):

- Desktop expanded = Sidebar 08. (256px)
- Desktop collapsed / mobile = Sidebar 07. icon rail (48px), with a Sheet
  overlay available for the expanded label view
- Context bar: org/project `Popover` switchers + theme toggle

## API access and auth

The console holds **no long-lived credential in the browser bundle**. It calls a
same-origin API base (`/api` by default), and a server-side proxy attaches the
`Authorization: Bearer` token before forwarding to the API. See the Vite proxy
config and environment variables below.

### Console sign-in (Console ADR 0003)

Console users sign in through the embedded `<zitadel-login>` widget on
`/login` (via `@zitadel/sdk-react`). Completing the flow exchanges the
widget's handoff token for the `__nextgen_session` HttpOnly cookie; the
pathless `_authed` layout guards every screen by confirming that cookie
against `GET /sessions/me` and redirects unauthenticated visitors to
`/login?next=…`. Sign-out lives in the sidebar user menu
(`DELETE /sessions/me`).

The cookie authenticates the console UI and the session endpoints; the
management API still authorizes via the server-held project secret (injected
by the proxy) until session-derived permissions land server-side — see
[ADR 0003](docs/adrs/0003-console-authentication.md) for the model and its
caveats (including the widget's dark-only styling for now).

### Runtime discovery and the default project (Console ADR 0004)

At boot the console fetches `GET /console/runtime.json` (public, served by
the Go server; proxied in dev) to learn the deployment `mode` and which
project to sign into. A standalone (self-host) deployment **tracks exactly
one project, and the server never creates it**: the first project created —
by the customer's `zitadel setup` (`POST /projects`) — becomes the default
the console signs into and manages. `platform.project_id` /
`NEXTGEN_PLATFORM_PROJECT_ID` pins a specific existing project instead.
While no project exists yet, the login screen shows a "run `zitadel setup`"
hint; refresh after setup and the console picks the new project up. Only
`standalone` mode exists today; `platform` (cloud portal) mode is future
work.

The runtime document also carries the default project's **publishable key**
(root ADR 036): a browser-safe, origin-scoped bearer the login widget sends
on flow calls and the handoff exchange. Sign-in therefore needs no
`CONSOLE_PROJECT_SECRET` — the secret remains only for the management
(operator-plane) data calls until session-derived permissions land
(ADR 0003 §4).

## Local development

The console manages an instance, so its screens are only honest against a real
backend: `@zitadel/api-mock` has no user store, so a users list read from it is
a fiction. **Default to the real-data loop.**

### Real data (default)

```sh
moon run console:dev-real
```

One command: boots an ephemeral real instance (binary runtime + embedded
Postgres, no Docker) via `@zitadel/testing`, bootstraps a project with the
default schema and login flow, seeds users, then starts the dev server with the
proxy bound to that instance. It prints the sign-in credentials
(`dev@zitadel.local` / `Console-dev-1` by default). HMR is the normal Vite loop.

Each run is a fresh database, so the seeded list is identical every time — a
screenshot diff reflects code changes, not reshuffled fixtures — at the cost of
signing in again after a restart. `--seed-only` boots and seeds without starting
Vite, for pointing a separately-running console at a fresh instance. Overrides:
`CONSOLE_DEV_EMAIL`, `CONSOLE_DEV_PASSWORD`, `CONSOLE_DEV_ZITADEL_PORT`,
`CONSOLE_DEV_ORIGIN`. See [`scripts/dev-real.mts`](scripts/dev-real.mts).

Note `listUsers` requires `user.read`, which only the **project secret** carries
— the browser-plane publishable key is deliberately refused
(`internal/api/user.go`). So real list screens need the proxy's
`CONSOLE_PROJECT_SECRET`, which this script supplies; sign-in alone does not.

### Mock backend

```sh
PORT=8080 moon run api-mock:start          # terminal 1
VITE_CONSOLE_PROJECT_ID=proj_dev_mock \
  moon run console:dev                     # terminal 2
```

Fast and offline, and the full sign-in loop works (the mock serves
`/sessions/exchange` and `/sessions/me`), with the same split
`identifier` → `password` flow the real server emits. Use it only for chrome that
needs no real data: it has **no user store**, so list screens cannot be
meaningful and nothing about authorization can be proven there. It also serves no
`/console/runtime.json`, so runtime discovery falls back to `standalone` and the
project id must come from `VITE_CONSOLE_PROJECT_ID`.

### Embedded build

```sh
moon run workspace:server
```

Serves the built bundle under `/ui/console/` — no HMR. Use it only to verify the
embed base path.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONSOLE_BACKEND_URL` | Node (dev proxy) | Upstream API origin (defaults in `vite.config.mts`) |
| `CONSOLE_PROJECT_SECRET` | Node (dev proxy) | Bearer attached by the proxy; never shipped to the browser |
| `VITE_CONSOLE_API_BASE` | Client | Same-origin API base the SDK calls (default `/api`) |
| `VITE_CONSOLE_PROJECT_ID` | Client | Dev override for the project id; when unset it is discovered from `/console/runtime.json` (Console ADR 0004) |

## Commands

```sh
moon run console:dev-real   # dev server + seeded real backend (preferred)
moon run console:dev        # dev server only (bring your own backend)
moon run console:test
moon run console:typecheck
```
