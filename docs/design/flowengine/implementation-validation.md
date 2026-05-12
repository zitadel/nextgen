# Flow Definition Validation

Validation runs in two layers:

1. **Schema** — [`flow-definition.yaml`](../../../api/openapi/endpoints/schemas/flow-definition.yaml)
   enforces shape: required fields, patterns, enums, types.
2. **Engine + storage** — everything the schema can't express: row-level
   uniqueness, cross-field consistency, graph properties, and resolution of
   external references.

This document covers layer 2.

## Storage delta

The Go domain (`internal/domain/flow_definition.go`) lags the design-intent
shape. The `flow_definitions` table mostly doesn't need to change: top-level
columns (`project_id`, `id`, `name`, `schema_version`, `status`, `purposes`,
`created_at`, `updated_at`) plus a `definition` JSONB blob holding everything
else.

- **[domain]** — Go struct + JSONB shape. No DDL.
- **[DDL]** — table-schema change.

| Stored today | Design-intent | Tag |
|---|---|---|
| no `UserSchema` field | `user_schema` URL on definition | domain |
| `Audience` singular pointers | `audience` arrays | domain |
| `Step.Type` + `Config map` | explicit `fields` / `actions` / `gates` / `sso_providers` / `on_success` / `complete` | domain |
| `Transitions` flat array | map keyed by action/outcome, value `{target, action?}` | domain |
| no uniqueness on `name` | `UNIQUE (project_id, name, schema_version)` | DDL |

> **Future optimization.** Audience filtering currently scans every row's
> JSONB. When the flow service outgrows in-memory filtering, promote
> `team_ids` / `app_ids` / `user_schema` to top-level columns with indexes —
> `purposes` is the existing precedent.

## Engine-checked rules

### Definition

- `name` unique within `(project_id, schema_version)`. **[DDL]**
- `user_schema` URL resolves to a user-type schema. May be deferred until
  the definition is promoted to runtime use.
- Every key in `initial_steps` also appears in `purposes`.
- Every value in `initial_steps` matches a step `name`.

### Step

- A non-terminal step does something: at least one of `fields`, `actions`,
  `sso_providers`, `gates`, `transitions.callback`.
- A terminal step (`complete` set) has nothing else.
- Every key in `actions` has a matching key in `transitions`.
- Every key in `transitions` is either an action name declared in this
  step's `actions`, or a reserved outcome: `user_not_found`, `callback`.
- When `sso_providers` is non-empty, `transitions.callback` is defined.
  The `sso` action itself is engine-handled and never appears in
  `transitions`.
- Every entry in `fields` resolves to a property in the referenced `user_schema` which should have been pre-registered via the schemas API.

### Graph

- Every transition `target` with no `action` resolves to a step in `steps`.
- Every transition with `action ∈ {switch, pivot}` targets a flow `name`
  that exists and is runtime-eligible in the same project.
- Every step in `steps` is reachable from some entry point in
  `initial_steps` by walking transitions. Catches dead steps — typos in
  transition `target`s or steps left unwired.
- Every non-terminal step has at least one outgoing transition.
- Every cycle of steps has at least one exit transition to a terminal step
  or another flow (`switch` / `pivot`). Prevents infinite loops. Pragmatic
  check; full liveness is undecidable.
- A step with an `x-identifier` field might define a `user_not_found` transition,
  otherwise an error will be return for "not found".

## Open questions

1. **When to resolve `user_schema`.** Every write, only at runtime use, or
   somewhere in between? Tied to the still-undecided flow-definition state
   model.
2. **Uniqueness key.** `(project_id, name)` or `(project_id, name, schema_version)`?
   The latter lets revisions coexist; recommended.
3. **Cross-project pivots.** Out of scope — pivots/switches resolve within
   the same `project_id`.
4. **Built-in default flow.** Should the project-wide default ship embedded
   (`go:embed`) and be exempt from the storage uniqueness check on `name`?
