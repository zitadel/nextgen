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
  empty everywhere: the client calls `/api/v1` (root ADR 077), and the dev
  proxy forwards it unchanged.
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
- [0007 Code layout](docs/adrs/0007-console-code-layout.md): the layers, what a
  feature folder holds, what stays in a route file, and where assets go.
- [0006 Cloud add-on](docs/adrs/0006-cloud-addon.md): put what only the hosted
  cloud needs (its analytics, sign-up, billing, support) in its add-on,
  [`apps/cloud-console`](../cloud-console/AGENTS.md), never behind a build flag
  here. The console reaches it only through `src/addon/contract.ts`; a
  component an add-on screen needs is exported from `src/addon/ui.ts`.

## Building UI

Read [`docs/styling.md`](docs/styling.md) before building any console UI: it
decides the surface (shadcn with unprefixed utilities here; Lit atoms belong to
the login surface) and owns the token rules. The atom recipe is in
[`apps/storybook/AGENTS.md`](../storybook/AGENTS.md).

Compose from the console's shared components before the primitives. A shape
the console already draws (a confirmation, a row menu, a choice card, a dialog
frame, a detail card) has one component under `src/components`; use it, and
when it lacks something add a prop rather than re-creating it with class
overrides. When no shared component exists yet, the screen that needs the
shape makes it shared, and the next copy is a bug. Spacing constants copied
between files are the sign the component is missing.

## Screens

- A list screen composes `src/components/resource-list.tsx` and a detail
  screen `src/components/detail-page.tsx` ("Resource list layout" and
  "Resource detail layout" in `docs/styling.md`). Follow the shipped screens
  under `src/routes/_authed/`: loader-fetched data, `$param` detail routes.
- A screen that acts on one project declares `staticData.scope: "project"`
  and reads the selected project (`?project=`) through
  `src/features/projects/project-scope.ts`: `projectScopeDeps` +
  `requireProjectScope` in loaders, `useRequiredProjectScope` in components.
- Never scope a management call with `getConsoleProjectId()`: that is the
  project the console signs into, not the one being managed.
- The sidebar lists a project's screens, with or without a selection: without
  one, a screen asks for a project first (Projects with `?next=`, D22).
- Projects (the home) and `/settings` are above every project: Projects lists
  the account's screens (`nav.view: "account"`, D27) around the project's,
  which ask for a project there (D34); `/settings` its own pages
  (`nav.view: "settings"`, D29).
- `/` is the project's Overview (D35): only reads a screen already makes, and no
  figures, since the API has no counts.
- Screens outside every project (billing, operators) go in one of those lists,
  never beside a project's screens; every screen keeps the one frame.
- `/events` swaps the project's list for Logs' (`NavView` `"logs"`, D30): its
  rows are views and filters the events feature draws, not `nav` routes.
- Send any combination of Logs' filters: the server bounds every read (root
  ADR 048). One that must fill its pages needs an index and a read plan there.
- A short Logs page with a token is not the end: say so and offer
  `Keep looking` (D30), and never follow a token without a click.
- Never hand-edit `src/routeTree.gen.ts`; the TanStack Router plugin
  regenerates it from `src/routes/`.
- In specs, assert on `router.state.resolvedLocation`, never
  `router.state.location`: ending on `location` can leave a loader's request
  in flight, which MSW reports as unhandled in a later test.
- In specs, import `createAppRouter` at the top of the file, never inside a
  test: the router mock in `src/test-setup.ts` fails a spec that does.

## Content-Security-Policy

- The console's policy allows its bundle and `index.html`'s inline script
  by hash. A change to that script changes the hash the cloud sends
  (repo-root `vercel.json`): `internal/staticui/console`'s test names the
  value to set.

## Analytics

- Send a custom event only through `src/addon/analytics.ts`, and list it in
  [`docs/product-analytics-events.yaml`](../../docs/product-analytics-events.yaml) in the same change.

## Code layout

Layers import downward only; `console:lint` fails an upward import
([ADR 0007](docs/adrs/0007-console-code-layout.md)): `routes/` → `app-shell/` →
`features/` → `components/`, `hooks/`, `lib/`, `api/`, `auth/`, `runtime/`.

- Put a resource's code in `src/features/<resource>/`: requests in `api.ts`, pure
  logic in `model.ts`, its components in `components/`.
- Never add a helper to `lib/` or `hooks/`, or a component to `components/`, that
  needs a resource's types or the API client; it belongs in a feature.
- Keep a route file to its definition, its screen and small private rows; move
  hooks, requests and sign-in logic to the feature.
- Keep imports between features free of cycles; Biome does not check this one.
- Put imported files in `src/assets/` and fixed-URL files in `public/`.
- `app-shell/logo.tsx` and the APK Futural file are copies of the website's;
  change them together.
- When a module moves, update the paths comments and docs name for it.

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
