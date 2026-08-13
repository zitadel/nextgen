# Flow Definition — Shape & Rules

> **Status:** Current
> **See also:** [Flow Engine](flow-engine.md) · [Architecture](architecture.md) · [OpenAPI schema](../../../api/openapi/endpoints/schemas/flow-definition.json)

A flow definition is a directed graph of steps stored as an API resource and
executed by the [flow engine](architecture.md). This document describes the
shape and the rules the engine enforces on top of the JSON schema.

Validation runs in two layers:

1. **Schema** — `api/openapi/endpoints/schemas/flow-definition.yaml` enforces required fields, types, enums, and string patterns.
2. **Engine** — the rules below, applied at write time and (where deferred) at runtime.

## Definition shape

| Field | Required | Notes |
|---|:-:|---|
| `name` | ✓ | Unique within `(project_id, schema_version)`. Used as the slug for direct resolution. |
| `schema_version` | ✓ | Monotonic per `(project_id, name)`. The repository picks the highest active version. |
| `status` | ✓ | `draft`, `active`, `deprecated`, `archived`. Only `active` is resolvable. |
| `user_schema` | ✓ | URL of the user schema this flow's `fields` resolve against. Captured into `FlowState.UserSchemaURL` at `Start` so mid-flow schema changes don't reshape in-flight data. |
| `purposes` | ✓ | Map from purpose (`login`, `register`, `recovery`, `profiling`, `reauth`, `link_account`) to the name of that purpose's entry-point step. |
| `audience` | optional | `app_ids[]`, `team_ids[]`. Empty = project default. Specificity for resolution is app > team > default. |
| `steps` | ✓ | Ordered list of `FlowDefinitionStep`. Order doesn't drive runtime; transitions do. |

`name`, `schema_version`, `status`, and `purposes` are top-level columns on `flow_definitions`; everything else is JSONB. Promote audience columns when in-memory filtering stops being good enough.

## Step shape

Steps have no `type`. The engine derives behavior from the properties that are
present.

| Property | Meaning |
|---|---|
| `name` | Unique within the definition. Used as the `Transitions` target. |
| `fields` | Ordered array of user-schema property names or reserved authentication-method fields such as `x-auth-methods#password`. Resolved at runtime to per-field type, validation, uniqueness scope, and `FlowFieldChallenge`. |
| `actions` | Ordered array of `{ name, kind, text_key?, primary? }`. The client echoes `name` back in `submit`. |
| `gates` | Definition-schema map of gate name → `{ kind, provider, config }`. Captcha is the only gate kind in the enum, but today's runtime neither emits nor enforces gates and rejects `gate_proofs`. |
| `sso_providers` | Definition-schema list of `{ id, name, template }`. Today's runtime does not emit providers and rejects SSO submissions. |
| `on_success` | Server-side mutation that runs after fields validate, before the transition fires. `create_user` today. |
| `complete` | Terminal classifier: `redirect` (frontend navigates to `redirect_uri`) or `show` (success screen). |
| `transitions` | Map of action name **or** engine-emitted outcome → `{ target, action? }`. `action` distinguishes intra-flow targets (`null`) from cross-flow `switch` / `pivot`. |

## Transitions

A transition key is one of:

- **Action name** declared in the step's `actions` map.
- **Engine-emitted outcome.** Reserved keys produced by the engine, not the
  client. Today: `user_not_found` and `user_already_exists` (from
  identifier-shaped fields, depending on the active `CurrentPurpose`),
  `callback` (SSO callback). More may follow — see
  [ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md).

Transition values:

| Value | Behavior |
|---|---|
| `{ target: "step_name" }` | Move within the current flow. `target` must be a step `name` in `steps`. |
| `{ target: "other-flow", action: "pivot" }` | Push the current `FlowProgress` onto `PivotStack`, switch to another definition. Returns on completion. **Reserved — not implemented.** |
| `{ target: "other-flow", action: "switch" }` | Replace the current flow entirely. No return. **Reserved — not implemented.** |

## Engine-checked rules

### Definition

- `name` unique within `(project_id, schema_version)`. **DDL.**
- Every key in `purposes` is a supported `FlowDefinitionPurpose`.
- Every value in `purposes` matches a step `name`.
- `user_schema` URL resolves to a user-type schema. May be deferred until promotion to runtime use.
- **Flip-table coverage.** A definition that serves both `login` and `register` must wire `user_not_found` (login entry) and `user_already_exists` (register entry) on the entry step. Solo-purpose flows don't need the counter outcome. See [ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md).
- **`on_success` manifest cross-check.** Every credential kind a mutation establishes (per `ManifestForOnSuccess`) must be collected on the step itself or on some upstream step in the graph. `create_user` establishes `{identifier, password}` — both must appear in `fields` somewhere reachable.

### Step

- A non-terminal step does something: at least one of `fields`, `actions`, `sso_providers`, `gates`, `transitions.callback`.
- A terminal step (`complete` set) has nothing else.
- Every key in `actions` has a matching key in `transitions`.
- Every key in `transitions` is either an action name declared in this step's `actions` or a reserved engine-emitted outcome.
- **`back` is a reserved action name.** The engine injects a `back` action on rendered responses when there's a step to return to (non-empty back stack on a non-terminal step). Authors must not declare an action named `back`, regardless of `kind`.
- When `sso_providers` is non-empty, `transitions.callback` is defined. The `sso` action itself is engine-handled and never appears in `transitions`.
- Every entry in `fields` resolves to a property in the referenced `user_schema`.
- A step with an identifier-shaped field (schema property with non-empty `x-unique`) may declare a `user_not_found` transition; absence of the transition means the engine errors on lookup failure rather than routing. See [ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md) for the direction this is heading.

### Graph

- Every transition `target` with no `action` resolves to a step in `steps`.
- Every transition with `action ∈ {switch, pivot}` targets a flow `name` that exists and is runtime-eligible in the same project.
- Every step in `steps` is reachable from some entry point in `purposes` by walking transitions. Catches dead steps.
- Every non-terminal step has at least one outgoing transition.
- Every cycle of steps has at least one exit transition to a terminal step or another flow. Pragmatic check; full liveness is undecidable.

## Authoring rules of thumb

- **Steps don't have a kind.** Don't try to encode "this is the password step" in the name — encode it in the fields, the `on_success`, and the transitions.
- **Reserved transition outcomes are part of the contract.** If the engine emits `user_not_found` on a step you didn't wire for it, the step errors instead of routing. Wire it explicitly even when the route is a same-target anti-enumeration redirect.
- **Schema annotations drive behavior.** `x-unique` makes a field an identifier (and contributes `user_not_found`). The reserved `x-auth-methods#password` field name combined with `x-auth-methods.password.enabled` makes a field a password challenge. Adding annotations to the schema can change how every flow that references the field behaves.
- **`on_success` is a side effect, not a decision.** It can short-circuit a step error, but routing comes from transitions and it never authenticates the user — a terminal step after `create_user` mints no handoff unless an identifier dispatch happens later in the graph.

## Open questions

- **When to resolve `user_schema`.** On write, only at runtime use, or somewhere in between? Tied to the still-undecided definition lifecycle.
- **Uniqueness key.** `(project_id, name)` or `(project_id, name, schema_version)`? The latter lets revisions coexist; recommended.
- **Cross-project pivots.** Out of scope — pivots and switches resolve within the same `project_id` when implemented.
- **Built-in default flow.** Should the project-wide default ship embedded (`go:embed`) and be exempt from the uniqueness check on `name`?
