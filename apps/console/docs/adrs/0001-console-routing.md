# Console ADR 0001: Routing

> **Status:** Proposed
> **Date:** 2026-06-29
> **Scope:** `apps/console` only. See [`apps/console/AGENTS.md`](../../AGENTS.md).
> **Context:** Console shell layout, navigation, and resource list pages
> (issue [#440](https://github.com/zitadel/nextgen/issues/440)).

## Context

The console (`apps/console`) is a Vite + React + TanStack Router SPA, but today
it is only **scaffold** — wired up just far enough to prove the app builds,
embeds, and runs. The current files (`__root.tsx` header + `<Outlet />`, an
`index.tsx` welcome page, and the two minimal router stubs in
[`src/main.tsx`](../../src/main.tsx) and [`src/router.tsx`](../../src/router.tsx))
are placeholders, not a design to preserve. The #440 build-out can start the
routing layer from scratch.

Issue #440 asks us to build the app shell (sidebar, header, responsive layout)
and the file-based routes for the API resources (users, teams, sessions,
projects, flow definitions, schemas, system). Starting fresh, we still want a
recorded decision up front so the first real route is written against an agreed
shape rather than whatever the placeholder happened to do. Three things are
worth fixing in the design before any route is built:

1. **Where the router is constructed.** There should be one obvious place that
   builds the router and owns the `declare module "@tanstack/react-router"`
   register augmentation — not a config inlined in the entry point plus a
   second factory variant, which is how the scaffold currently looks.

2. **How the basepath is chosen.** The router basepath has to match the Vite
   `base` ([`vite.config.mts`](../../vite.config.mts):
   `command === "build" || isPreview ? "/ui/console/" : "/"`). We want a single
   source of truth for that prefix rather than a hand-written, per-environment
   copy — `vite preview` (PROD-built assets served by a "serve" command) is the
   case a naive `import.meta.env.PROD` check gets wrong.

3. **Data-loading and boundary convention.** #440 requires every list page to
   have loading, empty, and error states. Whether that comes from route
   `loader`s or in-component fetching, and where pending/error/not-found
   boundaries live, should be decided once.

The console is embedded into the Go server under `/ui/console/` and served as
a static SPA with an `index.html` fallback for unknown client routes (see
[`internal/staticui/handler.go`](../../../../internal/staticui/handler.go)).
Routing decisions therefore have to survive a hard refresh on a deep link.

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
factory and is the only one in the app. (The placeholder scaffold currently
has two router stubs; the build-out replaces them with this single factory.)

Router options are decided once, in that factory:

- `defaultPreload: "intent"` — preload route data on link hover/focus.
- `scrollRestoration: true`.
- `basepath` — derived, not hardcoded (next section).

### 3. Basepath is derived from the Vite base, not branched on `PROD`

The router `basepath` is derived from `import.meta.env.BASE_URL` (the value
Vite injects from the `base` option) rather than re-deriving the prefix from
`import.meta.env.PROD`:

```ts
// the single router factory
const basepath = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;
```

This makes the router prefix track [`vite.config.mts`](../../vite.config.mts)
automatically: `BASE_URL` is `/ui/console/` for `build`/`preview` and `/` for
the dev server, so the router and the emitted asset base can never disagree —
including the `vite preview` case that a `PROD` check gets wrong. The
`/ui/console/` prefix is owned by exactly one file (`vite.config.mts`); the
router consumes it.

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
  router options and the register augmentation have a single home, instead of
  the placeholder scaffold's two stubs.
- **Prefix can't drift.** Deriving `basepath` from `BASE_URL` ties it to the
  Vite `base`, so adding/renaming the embed prefix is a one-file change and
  `vite preview` behaves like production.
- **Deep-link safe.** File-based routes plus the Go SPA `index.html` fallback
  mean a hard refresh on `/ui/console/users/123` rehydrates the right route.
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
