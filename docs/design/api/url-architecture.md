# URL Architecture

> **LOCKED: Flat-by-ID with pragmatic nesting.** Globally-unique IDs mean the URL doesn't have to carry scope. For vocabulary, [`../glossary.md`](../glossary.md). For the data layer stack, [`hierarchy.md`](hierarchy.md). For permission names, [`system-permission-catalog.md`](system-permission-catalog.md).

## The rule

> Does this resource have a globally-unique ID that means something outside its parent's context?
>
> - **Yes** → top-level, flat. Scope resolved from the ID on read/update/delete; passed in the body or query on create/list.
> - **No** → nested under its parent, one level only.

## Scope resolution as a first-class invariant

Every endpoint declares internally:

```
resource_kind   : user
operation       : read | list | create | update | delete | <verb>
scope_source    : path.id | query.project_id | body.project_id | credential
required_perms  : user.read
```

This yields a testable matrix: `credential → requested resource → resolved scope → required permission → decision`.

**Collection endpoints must never infer broad scope silently.** `GET /users` without a scope parameter returns 400, not "all users you can see." Callers pass `?project_id=…` (or the credential must be pre-scoped to exactly one project). Aggregation across projects is a deliberate, named operation, not an accident of omission.

## ID resolution mechanism — the critical invariant

Given `GET /users/user_01H…`, the route only has a user ID. Before the DAL can enforce `project_id`, the server needs to know which project that user belongs to. Without an explicit answer, "flat-by-ID" accidentally becomes "query first, authorize later" — the exact anti-pattern we're avoiding.

**LOCKED mechanism: a global resource-scope index, consulted by middleware before authorization.**

```
resource_scope_index:
  resource_id (PK)    TEXT    -- e.g., "user_01HXY…"
  resource_kind       TEXT    -- e.g., "user"
  project_id          TEXT    -- always set (every resource lives in a project; the platform is a reserved project)
  team_id             TEXT    -- NULL when resource is project-scoped, set when team-scoped
```

This is a small, high-read table (one row per globally-addressable resource), cached aggressively. Every request with a path-ID goes through this resolution step *before* authorization:

```
path.id → resource_scope_index lookup → ctx.project_id / ctx.team_id
  → authorization check (credential × resolved scope × required permission)
  → DAL query (WHERE project_id = ctx.project_id AND id = path.id)
```

If the ID doesn't exist in the index, the request 404s before any auth check — which also prevents ID-enumeration oracles. If authorization fails, the request 404s (not 403) so attackers can't probe for existence.

We deliberately do not encode scope hints into IDs. That would leak hierarchy structure, prevent clean re-sharding, and bind us to a scope model for the lifetime of every ID we've ever issued. Opaque IDs + a dedicated index is the right trade.

> **Note:** The resource-scope index is hot and load-bearing — read on every path-ID request. MVP starts with performant SQL lookups plus in-process LRU caching and careful invalidation on resource deletion/transfer. Distributed caching can be added later if measurements require it. Slow lookups here = slow everything.

## DAL-level tenant isolation

Authorization at the middleware layer is necessary but not sufficient. Every query against project-scoped data must constrain by `project_id`. We don't rely on code-review discipline for this — we enforce it mechanically at the DAL layer, engine-agnostic (portable across Postgres, Spanner, and anything else we might pick).

**LOCKED: scope-bound repositories.** Project-scoped tables are only reachable through repository functions that take a `ScopeContext` carrying the resolved `project_id` (and `team_id` where relevant). The repository layer is the *only* call site that issues queries against those tables; raw database access is not exposed for scoped tables.

Concretely:

- Every scoped repository function signature is `(ctx ScopeContext, …) → …`. The context type is non-constructible without a resolved `project_id` — it can only be produced by the authorization middleware after the resource-scope index has resolved scope.
- The query builder unconditionally appends the scope predicate (`project_id = ctx.project_id`, plus `team_id = ctx.team_id` for team-scoped tables). There is no code path that issues a query against a scoped table without it.
- Repositories never expose raw SQL handles or ORM escape hatches for scoped tables.

This is defense-in-depth at the code-structure level: the primary mechanism (the `WHERE`-clause predicate) and the backstop (the type system + repository surface) are the same mechanism, enforced by the type checker and linted in CI.

> **Note:** Build a lint that fails CI if a project-scoped table is added without a matching repository function that takes a `ScopeContext`, or if raw query access to the table is exported. This is the portable equivalent of what Postgres RLS would give on a single-engine deployment.

> **Why not database-level RLS?** Postgres RLS is a powerful per-row policy engine bound to session variables. Spanner and other targets we may deploy on do not have an equivalent. Relying on RLS would fork the enforcement story by engine. The scope-bound repository pattern enforces the same invariant uniformly regardless of the underlying store.

## Action verbs — LOCKED (slash)

Two conventions were debated:

- Stripe-style: `POST /users/{id}/verify_email`
- Google AIP-136 style: `POST /users/{id}:verify_email`

The colon form is unambiguous to parsers and prevents namespace collisions between verbs and nested resources. The slash form matches the muscle memory of our target audience (Stripe, Vercel, GitHub, Linear — all slash-based). Since this API is intentionally optimised for Stripe/Vercel-grade DX, we accept the marginally higher collision risk and lock slash.

**Collision mitigation:** verb names are always imperative-mood and never plural nouns. `verify_email`, `rotate`, `revoke`, `transfer` — never `verifications`, `rotations`. If a legitimate nested resource called `verifications` ever becomes necessary, the verb gets renamed (e.g. `send_verification_email`) before that resource ships.

## 404 vs 403

Cross-project / no-foothold denials return **404 Not Found** so callers cannot
probe which project ids exist. Inside a project the principal already has a
foothold in, missing permission returns **403 Forbidden**
([ADR 033](../../adrs/033-internal-permission-management.md)). Self resources
the caller already knows exist (e.g. `PATCH /me`) also return 403 when
disallowed.

## Continuity note

Older design notes described a "credential drops the project from the URL" rule (project-scoped credentials → `POST /users`; human credentials → `GET /projects/{project_id}/users`). That rule is a **special case** of flat-by-ID: when a credential's scope is unambiguous, the scope doesn't need to be repeated in the URL. Both shapes are valid; the flat-by-ID model expresses this uniformly through the resource-scope index.

## See also

- [`../glossary.md`](../glossary.md) — canonical terms
- [`hierarchy.md`](hierarchy.md) — data layer stack
- [`authz.md`](authz.md) — the permission check that runs after scope resolution
- [`resource-map.md`](resource-map.md) — which resources are flat vs nested
