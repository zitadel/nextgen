# Console ADR 0001: Routing

> **Status:** Accepted
> **Date:** 2026-06-29 (accepted 2026-06-30)
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
  [`internal/staticui/handler.go`](../../../../internal/staticui/handler.go)).
  Routing must survive a hard refresh on a deep link, and the client basepath
  must line up with that embed prefix.
- That embed prefix is owned by the Vite `base`
  ([`vite.config.mts`](../../vite.config.mts): a build/preview prefix, `/` for
  the dev server), so the router should take the prefix from there rather than
  declaring its own copy.

## Decision

### 1. File-based routing with a generated route tree

The console uses **TanStack Router file-based routing**. Routes live under
`src/routes/`; the `@tanstack/router-plugin` (already configured in
[`vite.config.mts`](../../vite.config.mts) with `autoCodeSplitting: true`)
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

This makes the router prefix track [`vite.config.mts`](../../vite.config.mts)
automatically: `BASE_URL` is the deployment prefix for `build`/`preview` and
`/` for the dev server, so the router and the emitted asset base always agree —
including under `vite preview` (PROD-built assets served by a "serve" command),
which is where an `import.meta.env.PROD` check would get the prefix wrong.

The concrete prefix value is **not** something routing should bake in. The
router stays value-agnostic: it reads whatever `BASE_URL` resolves to, so the
prefix is owned by exactly one file (`vite.config.mts`) and can be changed — or
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
  [`apps/console/vite.config.mts`](../../vite.config.mts).
- [`internal/staticui/handler.go`](../../../../internal/staticui/handler.go)
  — SPA fallback that makes deep links survive refresh.
- Root [ADR 014: Design tokens and paired React components](../../../../docs/adrs/014-design-tokens-and-ui-react-pairs.md)
  — the `@zitadel/ui-react` chrome the shell is built from.
