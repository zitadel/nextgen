# ADR 021: Ordered Arrays for Step Fields, Actions, and Gates

> **Status:** Proposed
> **Date:** 2026-06-05
> **Context:** Flow engine wire contract, Liquid template rendering, flow definitions

## Decision

The runtime step payload ([`flow-step.yaml`][flowstep]) and the definition step payload
([`flow-definition-step.yaml`][flowdefstep]) serialize `fields`, `actions`, and `gates`
as **ordered arrays of `{name, ...}` objects**, not as dictionaries keyed by name.

`sso_providers` keeps its existing array shape; the definition's `fields: []string` keeps
its existing array shape. `transitions` stays a dictionary — it is a pure outcome→target
lookup with no rendering-order semantics.

To preserve dictionary-style lookups in the default Liquid template (`{% if fields.email %}`,
`{% if actions.passkey %}`), the renderer augments the template's context with a
name-keyed map alongside each array. That map is render-local and never crosses the wire.

### Before / after

Runtime step response — `step.fields`, `step.actions`, `step.gates`:

```jsonc
// Before — dicts keyed by name; JSON key order is non-deterministic.
{
  "name": "login",
  "fields": {
    "email":    { "type": "email",    "text_key": "login.field.email",    "required": true },
    "password": { "type": "password", "text_key": "login.field.password", "required": true }
  },
  "actions": {
    "submit":   { "text_key": "login.action.submit", "primary": true },
    "register": { "text_key": "login.action.register" }
  },
  "gates": {
    "bot_check": { "kind": "captcha", "provider": "altcha", "config": { /* ... */ } }
  }
}

// After — ordered arrays of {name, ...} entries; declaration order is preserved.
{
  "name": "login",
  "fields": [
    { "name": "email",    "type": "email",    "text_key": "login.field.email",    "required": true },
    { "name": "password", "type": "password", "text_key": "login.field.password", "required": true }
  ],
  "actions": [
    { "name": "submit",   "text_key": "login.action.submit", "primary": true },
    { "name": "register", "text_key": "login.action.register" }
  ],
  "gates": [
    { "name": "bot_check", "kind": "captcha", "provider": "altcha", "config": { /* ... */ } }
  ]
}
```

Flow definition step — same change on `actions` and `gates` (`fields` is already `[]string`,
`transitions` stays a dict):

```yaml
# Before
- name: login
  fields: [email, password]
  actions:
    submit: { primary: true }
    register: {}
  gates: {}
  transitions:
    submit:   { target: password }
    register: { target: register, action: switch }

# After
- name: login
  fields: [email, password]
  actions:
    - { name: submit, primary: true }
    - { name: register }
  gates: []
  transitions:           # unchanged — pure lookup, no display order
    submit:   { target: password }
    register: { target: register, action: switch }
```

Default Liquid template — iteration flips, keyed lookups stay via the render-local map:

```liquid
{# Before — iterate the dict; key/value via entry[0] / entry[1]. #}
{% for entry in fields %}
  <zl-field name="{{ entry[0] }}" type="{{ entry[1].type }}" ...></zl-field>
{% endfor %}

{% if fields.email and fields.password and step.name == 'identifier' %}
  <a data-action="recover">{{ 'action.forgot_password' | t }}</a>
{% endif %}

{% if actions.passkey %}
  <zl-button action="passkey" label="{{ actions.passkey.text_key | t }}"></zl-button>
{% endif %}

{# After — iterate the array; lookups go through the render-local *_by_name map. #}
{% for f in fields %}
  <zl-field name="{{ f.name }}" type="{{ f.type }}" ...></zl-field>
{% endfor %}

{% if fields_by_name.email and fields_by_name.password and step.name == 'identifier' %}
  <a data-action="recover">{{ 'action.forgot_password' | t }}</a>
{% endif %}

{% if actions_by_name.passkey %}
  <zl-button action="passkey" label="{{ actions_by_name.passkey.text_key | t }}"></zl-button>
{% endif %}
```

Go domain types — `Name` moves onto each entry; the container becomes a slice:

```go
// Before
type FlowStep struct {
    Name    string
    Fields  map[string]FlowField
    Actions map[string]FlowStepAction
    Gates   map[string]FlowStepGate
    // ...
}

type FlowField struct {
    TextKey  string
    Type     FlowFieldType
    Required bool
    // ...
}

// After
type FlowStep struct {
    Name    string
    Fields  []FlowField
    Actions []FlowStepAction
    Gates   []FlowStepGate
    // ...
}

type FlowField struct {
    Name     string  // moved onto the entry
    TextKey  string
    Type     FlowFieldType
    Required bool
    // ...
}
```

## Context

Maintaining declaration order of `fields` and `actions` through the default Liquid template
is not practical with the current dict-keyed payload. The template renders by iterating
`{% for entry in fields %}` and `{% for entry in actions %}`
([`internal/api/branding/default.liquid:23,57`][liquid]), and visible order randomizes
between renders because:

- Go's `map` iteration is non-deterministic by design.
- The ogen-generated marshaller ranges the map directly without sorting
  (`api/generated/oas_json_gen.go:8979`).
- The flow definition is authored with intended order
  (e.g. `fields: [email, password]` in [`flow-definition-step.yaml`][flowdefstep]), but the
  resolver collects fields into `map[string]FlowField`
  (`internal/domain/flow_field_resolver_schema.go:64`) and the wire shape drops that order
  before it reaches the browser.

Same shape, same problem, on `actions` and `gates`.

Three alternatives were considered:

- **(A) Sort keys alphabetically in the encoder.** Deterministic but wrong: `family_name`
  before `given_name`, `password` before `password_confirm`. Authorial order is not
  alphabetical.
- **(B) Add a sibling `field_order: []string` (and `action_order`).** Keeps the dict
  shape and makes order external. Honest, but the wire contract then has two ways to
  express the same thing, and the dict still tempts consumers to iterate it directly.
- **(C) Switch to ordered arrays of `{name, ...}` entries.** Makes order load-bearing in
  the contract. Breaks the `fields.email` / `actions.passkey` template idiom on the wire,
  but we can keep that ergonomic via a render-local name map.

We picked **(C)**. Order is part of the meaning of the payload — encoding it in the type,
not in a parallel array, prevents the "Go map round-trip silently drops order" class of bug
at every layer (resolver, mapper, encoder, mock). The template ergonomics regression is
solved server-side without polluting the wire.

We are in MVP; there are no external API consumers to migrate, so this is a one-shot
contract change.

## Consequences

This list doubles as the implementation checklist.

**OpenAPI**
- `flow-step.yaml` — `fields`, `actions`, `gates`: `object → array of {name, ...}`. New
  components for the entry shapes (e.g. `FlowStepFieldEntry`, `FlowStepActionEntry`,
  `FlowStepGateEntry`).
- `flow-definition-step.yaml` — `actions`, `gates`: `object → array of {name, ...}`.
  `transitions` unchanged. `fields` already `[]string`, unchanged. Separate entry components
  from the runtime ones to keep the two contracts free to evolve.
- `flow-definition-update-request.yaml` — derives from the definition step; the change
  rolls through automatically.
- Re-generate ogen types.

**Domain (Go)**
- `FlowStep.Fields/Actions/Gates` (`internal/domain/flow_state_machine.go:88`) → slices of
  entries with `Name` embedded on each item.
- `FlowDefinitionStep.Actions/Gates` (`internal/domain/flow_definition.go:153`) → slices
  with `Name` embedded.
- `FlowField`, `FlowStepAction`, `FlowStepGate` gain a `Name` field.
- `flow_field_resolver_schema.go` — return `[]FlowField` in declaration order instead of
  `map[string]FlowField`.
- `flow_definition_validator.go` — add a small `findActionByName` helper for the few
  cross-references against `Transitions` (which stays a dict).
- Other callsites that did `fields[name]` lookups (`prefillFromCollected`,
  `findCollectedFieldByChallenge`) switch to slice iteration or a local lookup helper.

**API mappers**
- `internal/api/flow.go` — `toFlowStepFields`, `toFlowStepActions`, `toFlowStepGates`
  build slices.
- `internal/api/flow_definition.go` — in→domain (lines 73-106) and domain→out
  (lines 208-225) become slice loops.

**Liquid templates** (`internal/api/branding/default.liquid` and
`packages/components/src/orchestrator/templates/default.liquid`)
- Iteration syntax: `{% for f in fields %}` exposes `f.name`, `f.type`, etc., replacing
  `entry[0]`/`entry[1]` indexing.
- Keyed lookups (`fields.email`, `fields.password`, `actions.passkey`, `actions.register`,
  `actions.sign_in`) keep working via a **render-context augmentation**: the renderer adds
  `fields_by_name` / `actions_by_name` / `gates_by_name` to the template variables
  alongside the array payloads. Final naming is subject to template review.

**Frontend orchestrator**
- `packages/components/src/orchestrator/zitadel-login.ts` — switch the four touchpoints
  using `Object.keys` / `Object.entries(step.fields)` to array iteration.

**Mock and CLI**
- `packages/api-mock/src/flow-machine.ts` — emit array payloads.
- `apps/cli/src/lib/flows/build.ts` — the step factories that emit
  `actions: { ... }, gates: { ... }` literals switch to array literals.
- CLI tests (`apps/cli/tests/integration/*`, `apps/cli/tests/unit/commands/*`) — update
  payload assertions.

**Tests**
- Domain: `flow_definition_test.go`, `flow_definition_validator_test.go`,
  `flow_state_machine_test.go`, resolver tests — map literals → slice literals.
- Integration: `internal/api/integration_test/*` — same, plus response-shape assertions
  (passkey, registration flows).
- Frontend: `zitadel-login.spec.ts`, api-mock spec.

**Out of scope**
- `transitions` stays a dictionary — pure lookup, no display order.
- No backwards-compatibility shims. There are no external consumers.

## Reviewer split

- **Backend:** OpenAPI changes + ogen regen, domain struct refactor, validator and
  resolver helpers, API mappers.
- **Frontend:** Liquid template syntax + render-context augmentation, orchestrator
  iteration, api-mock payloads.
- **CLI:** flow-definition build helpers and their tests.

## Future work

- If a future external consumer needs O(1) lookup on fields/actions/gates, they build a
  client-side index from the array. The wire shape stays array-only — arrays are the
  source of truth, indexes are derived.
- The render-context augmentation pattern can be lifted into a shared helper if other
  templates or consumers want the same array+map dual view.

[flowstep]: ../../api/openapi/components/flows/flow-step.yaml
[flowdefstep]: ../../api/openapi/components/flows/flow-definition-step.yaml
[liquid]: ../../internal/api/branding/default.liquid
