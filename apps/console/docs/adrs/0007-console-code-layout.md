# Console ADR 0007: Code layout

> **Status:** Accepted
> **Date:** 2026-11-05
> **Scope:** `apps/console` only. See [`apps/console/AGENTS.md`](../../AGENTS.md).
> **Builds on:** [ADR 0001](0001-console-routing.md), which owns how routes,
> loaders and the sidebar work, and [ADR 0006](0006-cloud-addon.md), which owns
> the add-on seam. This ADR owns where the code behind them lives.

## Context

Routing was already well separated, but the code around it had no rule for
where anything goes:

- `src/lib/` mixed pure helpers, API reads and React hooks. One module,
  `project-scope.ts`, held all three plus route guards.
- `src/components/` was a flat list that mixed generic parts with single-use
  domain components.
- Route files carried hooks, security logic and large sub-components, up to 600
  lines.

Nothing enforced a direction, so these would have drifted back after any
one-off cleanup.

## Decision

### 1. Layers, with imports pointing one way

```
routes/, addon/         route definitions and screens; the add-on seam
  app-shell/            the chrome: sidebar, top bar, search, boundaries
    features/<name>/    one resource's reads, logic, hooks and components
      components/ hooks/ lib/ api/ auth/ runtime/
```

A layer may import from layers below it, never above.

| Folder | May not import |
| --- | --- |
| `features/` | `routes/`, `app-shell/` |
| `app-shell/` | `routes/` |
| `components/` | `routes/`, `addon/`, `app-shell/`, `features/`, `api/`, `auth/` |
| `lib/`, `hooks/` | all of the above, plus `components/` |

- `lib/` and `hooks/` know nothing about Zitadel's resources: a helper there
  would make sense in any admin app.
- `components/` takes everything as props and never calls the API. `ui/` is
  shadcn, and `user-avatar` and `project-mark` stay here because several
  features and the shell draw them.
- `api/`, `auth/` and `runtime/` are the console's connection to its server:
  the client, the session and the deployment document.
- `addon/` mounts add-on screens on the route tree and exports the component kit,
  so it reaches across the layers. Features may report through
  `addon/analytics.ts`. Its contract is ADR 0006's.
- `nav.ts`, `theme.ts`, `router.tsx` and `main.tsx` stay at the root of `src/`:
  each is one app-wide concern.

The app shell is its own layer rather than part of `components/`, because it has
to name projects and teams, so it can't be generic.

### 2. One feature folder per resource

```
features/<name>/
  api.ts        requests
  model.ts      pure: types and logic with no requests and no React
  <concern>.ts  a larger concern of its own, such as column-pins.ts
  components/   components only this resource draws
```

A file exists only when there is something to put in it. Specs sit next to what
they test.

A screen's route specs stay under `routes/`, since they drive the real router.

### 3. Features depend on each other in one direction

A feature may import another feature's files directly: there are no barrel files
to maintain. The dependency graph must stay free of cycles.

When two features would need each other, split or move the shared part. Two
examples:

- `fetchTeamUsers` lives in `features/users/` because it is a query on users,
  and `features/teams/` imports it.
- Every deployment screen needs the selected project, and the project page lists
  deployments' origins. So `features/projects/` holds the selection and the
  project list, `features/project-settings/` holds that page's panels, and
  `features/deployments/` sits between them.

Biome does not check this one, so check it when adding a cross-feature import.

### 4. What stays in a route file

A route file holds:

- the route definition: `staticData`, search validation, guards and the loader
  call
- the screen component, which reads `Route.use*` and composes the page
- small private pieces that only make sense in that table, such as a row or a
  one-item row menu

Everything else moves to the feature. That means hooks, requests beyond one
direct call, sign-in security decisions, and any sub-component with its own state
or length that gets in the way of reading the screen. This is a judgement call,
not a line limit.

### 5. Assets

| Kind | Where | Why |
| --- | --- | --- |
| Files the code imports (fonts) | `src/assets/` | Vite hashes them, so they can be cached forever |
| Files that need a fixed URL | `public/` | Vite prefixes the deployment's base when it builds `index.html` |
| Icons | `lucide-react` | The design system's set |
| The animated logo | `app-shell/logo.tsx` | Inline SVG, so it takes `currentColor` and its CSS motion |

### 6. Biome enforces the layers

`style/noRestrictedImports` overrides in the root `biome.json` fail `turbo run
lint --filter=@zitadel/console` when a file imports upward, by `@/` alias or by relative path.
Keep that table and §1's in step.

## Considered and left

- **Route-local folders** (`routes/users/-components/`): the plugin would ignore
  them, but several routes share these parts (the Team screen draws user cells),
  so they would end up moving anyway.
- **One shared row menu:** `RowMenu` in `resource-list.tsx` is already the shared
  part. What remains in each `RowActions` is just that screen's links.
- **A constant for `limit: 100`:** each is one request's page size inside a
  read-everything loop, read in place, with nothing to keep in step. List screens
  do share one page size, `LIST_PAGE_SIZE`, since the same design decision sets it.
- **Splitting `features/deployments/` further:** releases and deployments call
  each other's reads, so one feature holds both.

## Open

- **A pathless `_authed/_project` layout** could own the scope check and pass the
  project id through route context, removing the `staticData.scope`,
  `projectScopeDeps` and `requireProjectScope` that every scoped screen repeats.
  It changes ADR 0001 and needs a spike first.

## Consequences

- A new resource has one obvious place, and a wrong import fails lint instead of
  waiting for review.
- Route files read as screens, so a screen's structure is visible at a glance.
- Moving code means changing import paths in many files. Paths named in comments
  and docs have to move with it.
