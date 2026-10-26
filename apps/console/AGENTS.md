# Agent Instructions — `apps/console`

## Decisions: read the console ADRs first

Before changing routing, navigation, the app shell or API access, read the
console ADRs ([index](docs/adrs/README.md)). If the code has to diverge from
one, update the ADR in the same change.

- [0001 Routing](docs/adrs/0001-console-routing.md): file-based routes, one
  router factory, `basepath` from the Vite `base`.
- [0002 API access](docs/adrs/0002-console-api-access.md): the console holds
  no script-readable credential. Call the API same-origin through
  `configureZitadel()` / `getApi()`, never a bespoke client. The base is
  `/api` only under the dev server; never reintroduce an `/api` shim on the
  server.
- [0003 Authentication](docs/adrs/0003-console-authentication.md): `/login`
  embeds the login widget, and the pathless `_authed` layout owns the session
  guard and the shell. The session cookie is the operator's credential for the
  management calls too: what a person can do is what their grants allow.
- [0004 Deployment modes](docs/adrs/0004-console-deployment-modes.md):
  - Keep the fallback to the pinned or first-created project
    (`platform.project_id`) until the seed transport ships, or self-hosters
    are stranded.
  - Render portal surfaces from effective permissions, never from
    membership, build-time flags or a console-only feature list.
  - An unreadable runtime document is an error, not a mode: keep it apart
    from "no project yet", and never fall back to `standalone` silently.
    Backend-less runs opt in with `VITE_CONSOLE_RUNTIME_FALLBACK`.

## Building UI

Read [`docs/styling.md`](docs/styling.md) before building any console UI: it
decides the surface (shadcn with unprefixed utilities here; Lit atoms belong to
the login surface) and owns the token rules. The atom recipe is in
[`apps/storybook/AGENTS.md`](../storybook/AGENTS.md).

## Screens

- A list screen composes `src/components/resource-list.tsx` and a detail
  screen `src/components/detail-page.tsx` ("Resource list layout" and
  "Resource detail layout" in `docs/styling.md`). Follow the shipped screens
  under `src/routes/_authed/`: loader-fetched data, `$param` detail routes.
- A screen that acts on one project declares `staticData.scope: "project"`
  and reads the selected project (`?project=`) through
  `src/lib/project-scope.ts`: `projectScopeDeps` + `requireProjectScope` in
  loaders, `useRequiredProjectScope` in components.
- Never scope a management call with `getConsoleProjectId()`: that is the
  project the console signs into, not the one being managed.
- The sidebar is Projects (the one unscoped entry), then the project's
  screens, listed with or without a selection: without one, a screen asks
  for a project first (Projects with `?next=`, D22). Screens outside every
  project (account, billing, operators) go in the project switcher or
  Settings, not the sidebar.
- Never hand-edit `src/routeTree.gen.ts`; the TanStack Router plugin
  regenerates it from `src/routes/`.
- In specs, assert on `router.state.resolvedLocation`, never
  `router.state.location`: ending on `location` can leave a loader's request
  in flight, which MSW reports as unhandled in a later test.

## Local loop

```sh
moon run console:dev-real   # real seeded instance + dev server (the default)
moon run console:dev-claim  # the same for the claim page
moon run console:dev        # dev server only, http://localhost:5174
moon run console:typecheck console:test console:build
```

- Develop against real data: `@zitadel/api-mock` has no user store, so a list
  read from it is fiction. When each backend applies is in the Local
  development section of [`README.md`](README.md).
- The claim page needs `dev-claim`: `claim/complete` accepts only a
  platform-project session, so on `dev-real` every claim fails with "This
  account can't claim the project". `dev-claim` pins the console to
  `proj_platform`, so list screens read empty and you register on the claim
  page instead of using the seeded users.
- Both tasks build the CLI they boot the server through. A direct
  `pnpm run dev:real` does not: run `moon run cli:build` first, or the server
  starts unmigrated and dies with `no such table: projects`.
- Run `pnpm install` after a rebase: a stale `node_modules` fails the built CLI
  on a missing transitive dependency.
- A server binary launched by hand (`dist/server/nextgen`) needs `--migrate`;
  the CLI passes it for you.
- Set `CONSOLE_DEV_ORIGIN` to run a second loop beside the first.
