# Console ADR 0001: Routing

> **Status:** Accepted
> **Date:** 2026-06-29 (accepted 2026-06-30; amended 2026-08-11, 2026-09-28, 2026-10-04, 2026-11-05, 2026-11-12)
> **Scope:** `apps/console` only. See [`apps/console/AGENTS.md`](../../AGENTS.md).
> **Context:** Console shell layout, navigation, and resource list pages
> (issue [#440](https://github.com/zitadel/nextgen/issues/440)).

## Context

Issue #440 builds the console (`apps/console`) into a real admin app: an app
shell (sidebar, header, responsive layout) and file-based routes for the API
resources (users, teams, sessions, projects, flow definitions, schemas,
system). This is a greenfield build — the routing layer is designed from
scratch, and this ADR records that design up front so the first route is
written against an agreed shape.

The decisions below answer three questions every route in the app depends on:

1. **Where the router is constructed** — one obvious home that builds the
   router and owns the `declare module "@tanstack/react-router"` register
   augmentation, so there is a single canonical router for the app.

2. **How the basepath is chosen** — the router basepath must match the
   deployment prefix in every environment without being maintained by hand.

3. **The data-loading and boundary convention** — #440 requires every list
   page to have loading, empty, and error states; where data is fetched and
   where pending/error/not-found boundaries live is decided once, not per page.

Two product constraints shape the answers:

- The console is **embedded into the Go server under a configurable deployment
  prefix** and served as a static SPA with an `index.html` fallback for unknown
  client routes (see
  [`internal/staticui/handler.go`](../../../../apps/api/internal/staticui/handler.go)).
  Routing must survive a hard refresh on a deep link, and the client basepath
  must line up with that embed prefix.
- That embed prefix is owned by the Vite `base`
  ([`vite.config.ts`](../../vite.config.ts): a build/preview prefix, `/` for
  the dev server), so the router should take the prefix from there rather than
  declaring its own copy.

## Decision

### 1. File-based routing with a generated route tree

The console uses **TanStack Router file-based routing**. Routes live under
`src/routes/`; the `@tanstack/router-plugin` (already configured in
[`vite.config.ts`](../../vite.config.ts) with `autoCodeSplitting: true`)
generates `src/routeTree.gen.ts`.

`src/routeTree.gen.ts` is a **generated file**: it is never hand-edited (per
the root [`AGENTS.md`](../../../../AGENTS.md) "Generated Files" rule). Routes
are changed by adding, renaming, or editing files under `src/routes/` and
letting the plugin regenerate the tree.

`autoCodeSplitting` stays on, so each route's component is a separate chunk —
important because the console grows one resource page at a time.

### 2. One router factory, one register augmentation

There is exactly **one** place that constructs the router: a single
`createAppRouter()` factory in [`src/router.tsx`](../../src/router.tsx).
[`src/main.tsx`](../../src/main.tsx) only imports and renders it — the entry
point does not build its own router. The
`declare module "@tanstack/react-router"` register block lives next to that
factory and is the only one in the app.

Router options are decided once, in that factory:

- `defaultPreload: "intent"` — preload route data on link hover/focus.
- `scrollRestoration: true`.
- `basepath` — derived, not hardcoded (next section).

### 3. Basepath is derived from the Vite base

The router `basepath` is derived from `import.meta.env.BASE_URL` — the value
Vite injects from its `base` option:

```ts
// the single router factory
const basepath = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;
```

This makes the router prefix track [`vite.config.ts`](../../vite.config.ts)
automatically: `BASE_URL` is the deployment prefix for `build`/`preview` and
`/` for the dev server, so the router and the emitted asset base always agree —
including under `vite preview` (PROD-built assets served by a "serve" command),
which is where an `import.meta.env.PROD` check would get the prefix wrong.

The concrete prefix value is **not** something routing should bake in. The
router stays value-agnostic: it reads whatever `BASE_URL` resolves to, so the
prefix is owned by exactly one file (`vite.config.ts`) and can be changed — or
dropped — there without touching any routing code. Hardcoding the prefix in the
router (as legacy code did) is explicitly out.

### 4. Route tree for the #440 resources

File-based routes map to the #440 navigation table. Resources expose a list
route and, where the API has a by-id read, a detail route:

```
src/routes/
  __root.tsx                       app shell: sidebar + header + <Outlet/>
  index.tsx                        Dashboard
  users/
    index.tsx                      Users list      GET  /users
    $userId.tsx                    User detail     (by-id read)
  teams/
    index.tsx                      Teams (placeholder — no list API yet)
  sessions/
    index.tsx                      Sessions list   GET  /sessions
  projects/
    index.tsx                      Project view    GET  /projects/{id}
  flow-definitions/
    index.tsx                      Flow defs list  GET  /flow_definitions
    $definitionId.tsx              Flow def detail
  schemas/
    index.tsx                      Schemas (placeholder)
  system/
    index.tsx                      Health dashboard
```

Detail routes use TanStack Router's `$param` file convention
(`$userId.tsx`, `$definitionId.tsx`). Placeholder routes (teams, schemas)
render a "not available yet" state rather than calling a non-existent
endpoint.

> **Amendment (2026-08-11):** the shipped tree has evolved past this sketch in
> two ways. First, every screen now lives under the pathless `_authed/` layout
> introduced by [ADR 0003](0003-console-authentication.md)
> (`src/routes/_authed/…`), with `login.tsx` outside the guard. Second,
> schemas is no longer a placeholder — #762 shipped schema list and detail
> (`_authed/schemas/{index,$schemaId}.tsx`) — and a `teams/` route was never
> created. Sessions list now speaks `POST /sessions/query` (the `GET /sessions`
> list endpoint was replaced by #757).

> **Amendment (2026-10-04):** `_authed/teams/{index,$teamId}.tsx` exist, and
> the tree has no sessions route.

> **Amendment (2026-09-28, #1299):** screens now act on a **selected project**
> carried as `?project=<id>` on the `_authed` layout, which validates it and
> retains it on every navigation (`src/features/projects/project-scope.ts`). `projects/index.tsx`
> is the Projects overview, where a project is selected; the project's own page
> moved to the scoped `project/index.tsx` (Project settings), and
> `projects/$projectId.tsx` only redirects there with that project selected.

> **Amendment (2026-11-05):** where the code behind a route lives is
> [ADR 0007](0007-console-code-layout.md). The pending, error and not-found
> boundaries are in `src/app-shell/boundaries.tsx`.

### 5. Data loading: route loaders, with three required boundaries

Data for a route is fetched in its **`loader`**, using the typed API client
from [Console ADR 0002](0002-console-api-access.md) — not with ad-hoc
`useEffect` fetching in the component. Loaders give the router a single place
to start the request (and to preload it on `intent`), and they make the three
states #440 requires fall out of the framework rather than hand-rolled
component flags:

- **Pending** — a route `pendingComponent` (or a shared one on the root)
  renders while the loader runs.
- **Error** — a route `errorComponent` renders when the loader throws
  (the `ApiError` from ADR 0002 carries `status` for status-specific copy,
  e.g. a 401 surface).
- **Empty** — the component renders an empty state when the loader resolves
  to zero rows. (Empty is a successful load, so it is the component's job, not
  a boundary's.)
- **Not found** — a `notFoundComponent` for unknown ids / routes.

A list page therefore has no loading/error bookkeeping of its own: it reads
already-loaded data via `Route.useLoaderData()` and only decides "empty vs
rows".

### 6. Navigation is data-driven from route metadata

The sidebar's grouping (the #440 "Identity" / "Configuration" groups) is not a
second hardcoded list that can drift from the routes. Each navigable route
declares its nav metadata via the router's `staticData`:

```ts
export const Route = createFileRoute("/users/")({
  staticData: { nav: { group: "Identity", label: "Users", order: 1 } },
  loader: ...,
  component: UsersList,
});
```

The sidebar component builds its grouped link list by reading `staticData.nav`
off the route tree, so adding a resource route automatically adds its nav
entry. Routes without `nav` metadata (e.g. `$userId` detail) do not appear in
the sidebar.

> **Amendment (2026-09-28, #1299):** a route that acts on the selected project
> also declares `staticData.scope: "project"`. The sidebar lists such a route
> only while a project is selected. The `_authed` guard gives any route opened
> without a selection the default one; with none to give (several projects), a
> scoped route goes to Projects with the requested location in `?next=`, and
> choosing a project returns there. The Projects overview is the one unscoped entry, listed
> first and alone until a project is selected; the selected project's screens
> follow it.

> **Amendment (2026-10-23, design decision D22):** the sidebar lists the scoped
> routes whether or not a project is selected, as Vercel's does. Opening one
> without a selection still goes to Projects with `?next=`; Projects is then
> headed `Continue to <screen>` with that screen's entry marked, and choosing
> a project goes on to it. `/` without a selection lands on Projects itself
> rather than by way of Users, since arriving asked for no screen.

> **Amendment (2026-10-26, design decision D24):** Projects is no longer a
> sidebar entry (`staticData.nav`); it is the console's home, opened by the
> logo and the project switcher's `All projects`, and the shell draws it
> without the sidebar. The sidebar holds the selected project's screens only.

> **Amendment (2026-11-09, design decision D27):** the shell draws one frame
> for every screen, and the route picks which of two lists the sidebar shows.
> Projects and `/settings` are above every project and show the account's
> (`staticData.nav.view: "account"`), which Projects heads; every other route
> shows the selected project's. The Settings view's own header is gone.

> **Amendment (2026-11-09, design decision D29):** the route picks between
> three lists. Projects shows the account's (`view: "account"`): Projects and
> one Settings row, the `/settings` route's own entry. `/settings` with
> anything beneath it shows Settings' (`view: "settings"`), under a heading
> row that leads back to Projects.

> **Amendment (2026-11-10, design decision D34):** the account list draws
> Projects, then the portal's entries, then the account's other entries; a
> portal entry named like an account one is left out. Its project-scoped rows
> link with `project: undefined`, so `_authed` does not retain the selection
> and the guard asks for a project as D22 has it.

> **Amendment (2026-11-11, design decision D38):** a selected project stays
> selected above every project. This replaces D34's `project: undefined` links
> and D27's pill: on Projects and `/settings` the account list's rows open in
> the selected project, and the pill names it. With none selected the pill
> says `All projects` and a project's row asks for one (D22, D31).

> **Amendment (2026-11-11, design decision D42):** the account list is the
> root's: Projects, then the reserved platform project's screens for someone
> who may act on it, then Settings. Those screens are the portal's own
> routes: a row of the root's selects the platform project (`?project=`), and
> while it is the selection the shell shows the account list on them, as on
> `/account`, and the pill says `All projects`. This replaces D34's amendment
> above, whose rows asked for a project. The list leaves out Overview, and the
> project's Settings row, whose pages head the root's Settings list before
> what an add-on adds; `/project` shows that list while the platform project
> is selected. `/events` leads back to Projects then. The `_authed` guard
> drops the selection for someone who may not act on that project.

> **Amendment (2026-11-12, design decision D44):** the top bar is a path from
> the root down, as Vercel's runs from the team to the project. On every
> screen that shows the account or root Settings list, and on any drawn for
> the platform project, it is the root's pill alone: `Platform` for someone
> who may act on the platform project, `All projects` for anyone else. Those
> screens (`/projects`, `/settings` with anything beneath it, `/account`)
> hold the root as the selection: the `_authed` guard sets `?project=` to the
> platform project for someone who may act on it and drops it for anyone
> else, and gives them no default, so no project stays selected there
> unnamed. Links up carry it already (`useRootSearch`). Inside a project the bar reads the root, a link to Projects, then the
> project's pill (`Platform / fabis-app ▾`), then the team on a team's page.
> The pill's list offers the platform in a section of its own above the
> projects and checks the row the pill stands for; choosing the platform keeps
> a list screen the root has and otherwise opens Projects. This replaces
> D36's kept selection, D38's pill on Projects and `/settings` and D42's
> `All projects` for the root.

> **Amendment (2026-11-10, design decision D35):** `/` is a screen again, the
> project's Overview, declaring `scope: "project"` and the portal list's first
> entry. The `_authed` guard sends it to Projects without `?next=` when no
> project can be chosen for the person, since arriving asked for no screen.
> The account list leaves the portal entry at `/` out.

> **Amendment (2026-11-10, design decision D30):** `/events` with anything
> beneath it shows a list of its own too, Events' (`NavView` `"events"`), under a
> heading row that leads back to the project's landing route, `/`. The route
> still picks the list, and it is the first whose rows are not
> `staticData.nav` entries: no route declares `view: "events"`. Its rows are the
> views of the one Events screen and its filters, which live in that route's
> search params (`validateSearch`) and which the events feature draws
> (`src/features/events/components/events-nav.tsx`). An Events URL therefore
> restores the list, the view and the filters on a refresh. A screen gets such
> a list only when its views and filters are navigation the way Events' are;
> every other entry stays a route with `staticData.nav`.

> **Amendment (2026-11-10, D30):** the Events list is the layout route
> `/events` (`routes/_authed/events/route.tsx`), which owns the filters
> (`validateSearch`) and the list's loader; `/events/` only carries the
> sidebar entry. An event, `/events/$eventId`, is its child and opens in a
> drawer over the list, as Vercel's Logs opens a request: the list's match
> stays, so opening or stepping through events never reads the list again, and
> the drawer's URL carries the list's filters. A loader that must not rerun
> when a child changes belongs to the layout route, keyed on the search it
> reads.

> **Amendment (2026-11-11, D30):** Events' list chooses the view from a picker
> (each view's glyph, name and what it holds), as Vercel's Logs chooses its
> kind of log, rather than one row per view, and keeps only the filters chosen
> from a list (time, category, type or status). The values a person pastes
> (the ids, the operation, the resource type, My activity) are set in the
> search above the table and shown there as chips. The URL keeps every filter
> as before.

> **Amendment (2026-11-11, design decision D38):** the screen and its list are
> named Events, as the route, the API and the CLI are, and the list's
> `NavView` is `"events"`.

> **Amendment (2026-11-11, design decision D40):** a project's Settings row
> opens a list of its own, as the root Settings row on Projects does (D29) and
> as Vercel's project Settings does: both Settings rows carry the arrow and
> swap the list. `/project` is a layout route (`routes/_authed/project/route.tsx`)
> that reads the project and draws its header; its pages are routes beneath it
> with `nav.view: "project-settings"` (General, Admins), and `/project/` only
> carries the portal entry and forwards to General. `/project` with anything
> beneath it shows that list under a heading row that leads back to the
> project's landing, `/`. The root Settings are the platform project's and may
> list other pages than a project's; only the way they open is shared.

## Consequences

- **One canonical router.** `main.tsx` renders the factory from `router.tsx`;
  router options and the register augmentation have a single home.
- **Prefix can't drift.** Deriving `basepath` from `BASE_URL` ties it to the
  Vite `base`, so adding/renaming the embed prefix is a one-file change and
  `vite preview` behaves like production.
- **Deep-link safe.** File-based routes plus the Go SPA `index.html` fallback
  mean a hard refresh on a deep link (e.g. `<prefix>/users/123`) rehydrates the
  right route.
- **States are free.** Loaders + `pendingComponent`/`errorComponent`/
  `notFoundComponent` deliver #440's loading/empty/error requirement without
  per-page boolean flags.
- **Sidebar follows routes.** Nav metadata on routes removes the risk of a
  separate nav array drifting from the real route tree.
- **Constraint:** every list/detail route must define a `loader` (even a
  trivial one) for the data-loading and preload story to hold; a route that
  fetches in `useEffect` instead is a deviation from this ADR.

## Related work

- Issue [#440](https://github.com/zitadel/nextgen/issues/440) — the work this
  ADR governs.
- [Console ADR 0002: API access & auth interceptors](0002-console-api-access.md)
  — the typed client loaders call.
- [`apps/console/src/router.tsx`](../../src/router.tsx),
  [`apps/console/src/main.tsx`](../../src/main.tsx),
  [`apps/console/vite.config.ts`](../../vite.config.ts).
- [`internal/staticui/handler.go`](../../../../apps/api/internal/staticui/handler.go)
  — SPA fallback that makes deep links survive refresh.
- Root [ADR 055: A Lit-only login surface, with the console on shadcn/ui](../../../../docs/adrs/055-lit-only-login-surface.md)
  — the shell is built from shadcn/ui in `src/components/ui/`, sharing only
  `--zl-*` with the login atoms.
