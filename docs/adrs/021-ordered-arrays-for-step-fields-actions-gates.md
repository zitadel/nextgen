# ADR 021: Ordered Arrays for Step Fields, Actions, and Gates

> **Status:** Accepted — 2026-06-05 (status updated 2026-08-11; originally Draft)
> **Date:** 2026-06-05
> **Context:** Flow engine wire contract, Liquid template rendering, flow definitions
>
> **Amendment (2026-08-11):** the ordered-array shape shipped for `fields` and
> `actions` in both `flow-step.yaml` and `flow-definition-step.yaml`. `gates`
> shipped as a map keyed by gate type — the array form was not adopted for
> gates. `transitions` remains a dictionary as decided below.

## Decision

The runtime step payload ([`flow-step.yaml`][flowstep]) and the definition step payload
([`flow-definition-step.yaml`][flowdefstep]) serialize `fields`, `actions`, and `gates`
as **ordered arrays of `{name, ...}` objects**, not as dictionaries keyed by name.
`transitions` stays a dictionary — it is a pure outcome→target lookup with no
rendering-order semantics.

The default Liquid template needs two views of the same data: ordered iteration
(`{% for f in fields %}`) to render the form, and lookup by name
(`{% if fields.email and fields.password %}`, `{% if actions.passkey %}`) to decide what
extra UI to show. Arrays cover iteration but not name lookup. So the code that invokes
the template — the browser orchestrator today, the Go server-side renderer if/when we add
one — builds a name-keyed map from the array at render time and passes both into the
template's context:

```ts
// In zitadel-login.ts, before calling liquid.renderSync(template, ctx):
const ctx = {
  step,
  fields:          step.fields,                                                    // array, from the API
  fields_by_name:  Object.fromEntries(step.fields.map(f => [f.name, f])),          // built locally
  actions:         step.actions,
  actions_by_name: Object.fromEntries(step.actions.map(a => [a.name, a])),
  // ...
};
```

The template iterates `fields`, looks things up in `fields_by_name`. The `*_by_name` maps
live only inside that render call; the JSON response on the wire still contains only the
arrays.

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
  ]
}
```

Flow definition step — same change on `actions` and `gates` (`fields` is already `[]string`,
`transitions` stays a dict):

```yaml
# Before
- name: login
  actions:
    submit: { primary: true }
    register: {}
  transitions:
    submit:   { target: password }
    register: { target: register, action: switch }

# After
- name: login
  actions:
    - { name: submit, primary: true }
    - { name: register }
  transitions:           # unchanged — pure lookup, no display order
    submit:   { target: password }
    register: { target: register, action: switch }
```

Default Liquid template — iteration flips, keyed lookups stay via the render-local map:

```liquid
{# Before #}
{% for entry in fields %}
  <zl-field name="{{ entry[0] }}" type="{{ entry[1].type }}" ...></zl-field>
{% endfor %}
{% if actions.passkey %}
  <zl-button action="passkey" label="{{ actions.passkey.text_key | t }}"></zl-button>
{% endif %}

{# After #}
{% for f in fields %}
  <zl-field name="{{ f.name }}" type="{{ f.type }}" ...></zl-field>
{% endfor %}
{% if actions_by_name.passkey %}
  <zl-button action="passkey" label="{{ actions_by_name.passkey.text_key | t }}"></zl-button>
{% endif %}
```

Go domain types — `Name` moves onto each entry; the container becomes a slice:

```go
// Before
type FlowStep struct {
    Fields  map[string]FlowField
    Actions map[string]FlowStepAction
    // ...
}
type FlowField struct { TextKey string; Type FlowFieldType; /* ... */ }

// After
type FlowStep struct {
    Fields  []FlowField
    Actions []FlowStepAction
    // ...
}
type FlowField struct { Name string; TextKey string; Type FlowFieldType; /* ... */ }
```

## Context

Maintaining declaration order of `fields` and `actions` through the default Liquid template
is not practical with the current dict-keyed payload. The template iterates
`{% for entry in fields %}` / `{% for entry in actions %}`, and visible order randomizes
between renders: Go's `map` iteration is non-deterministic, and the ogen-generated
marshaller ranges the map directly without sorting
(`api/generated/oas_json_gen.go:8979`). The flow definition is authored with intended order,
but the resolver and the wire shape drop it on the way out. Same shape, same problem, on
`actions` and `gates`.

Three alternatives were considered:

- **(A) Sort keys alphabetically in the encoder.** Deterministic but wrong: `family_name`
  before `given_name`, `password` before `password_confirm`. Authorial order is not
  alphabetical.
- **(B) Add a sibling `field_order: []string` (and `action_order`).** Keeps the dict
  shape and makes order external. Honest, but the wire then has two ways to express the
  same thing, and the dict still tempts consumers to iterate it directly.
- **(C) Switch to ordered arrays of `{name, ...}` entries.** Makes order load-bearing in
  the contract. Breaks the `fields.email` / `actions.passkey` template idiom on the wire,
  but we restore it ergonomically via a render-local name map.

We picked **(C)**. Encoding order in the type — not in a parallel array — prevents the "Go
map round-trip silently drops order" class of bug at every layer. We are in MVP and have
no external API consumers to migrate, so this is a one-shot contract change.

## Consequences

The change touches the OpenAPI schemas (`flow-step.yaml`, `flow-definition-step.yaml`),
the ogen-generated types, the Go domain structs and their few name-lookup callsites, the
API mappers, both copies of the default Liquid template plus the renderer's context
augmentation, the frontend orchestrator's iteration helpers, the api-mock payloads, the
CLI flow-definition builders, and their respective tests. `transitions` is explicitly out
of scope; no backwards-compatibility shims since there are no external consumers.

## Future work

If a future external consumer needs O(1) lookup on fields/actions/gates, they build a
client-side index from the array — the wire shape stays array-only. The render-context
`*_by_name` augmentation can be lifted into a shared helper if other templates want the
same dual view.

[flowstep]: ../../api/openapi/components/flows/flow-step.yaml
[flowdefstep]: ../../api/openapi/components/flows/flow-definition-step.yaml
