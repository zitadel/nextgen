# Validator

**Status:** Stub. See [`README.md`](README.md) open question 7. **Parent:** [`README.md`](README.md). **Scope:** Structural checks only (required atoms present, `{% required_atoms %}`). Security (XSS, CSP, filters, DOMPurify) is [`../flowengine/template-security.md`](../flowengine/template-security.md). Run both.

A template is structurally valid if, for every reachable step, required fields and gates have matching `<zl-*>` tags. Static pass before render; `{% required_atoms %}` patches gaps at runtime.

```mermaid
flowchart TB
    T[Template string]
    T --> SEC["Security (XSS, CSP, filters)"]
    T --> STR["Structural (fields, gates, atoms)"]
    SEC --> OK[Allowed to run]
    STR --> OK
```

## Relationship to the security validator

| Concern | Validator | Source | Runs when |
|---|---|---|---|
| XSS, auto-escape, banned filters (`raw`), CSP enforcement, DOMPurify sanitisation | **Security** | [`../flowengine/template-security.md`](../flowengine/template-security.md) | Server-side on save. Non-negotiable. |
| Required fields/gates present, one primary action, no unknown atoms, `{% required_atoms %}` emitted | **Structural** (this doc) | Atom manifests + flow definition | Client-side on load + editor/CI. Falls back on failure. |

Authoritative XSS/CSP rules live in `template-security.md`. This file is capability coverage only.

## Atom manifest

Every `<zl-*>` atom ships a machine-readable manifest the validator and editor consume:

```json
{
  "tag": "zl-field",
  "consumes": { "field": { "required": true } },
  "attrs":    ["name", "label", "type", "autocomplete", "required", "pattern"],
  "parts":    ["root", "label", "input", "error"],
  "slots":    ["prefix", "suffix", "help"]
}

{
  "tag": "zl-submit",
  "consumes": { "action": { "kind": "submit", "required": true } },
  "attrs":    ["action", "label", "loading"],
  "parts":    ["root", "button", "spinner"],
  "slots":    []
}

{
  "tag": "zl-captcha",
  "satisfies_gate": "captcha",
  "attrs":    ["text", "solved"],
  "parts":    ["root", "widget", "status"],
  "slots":    []
}
```

Manifests are the single source of truth for parts, slots, and what an atom binds to on the step.

## Static validation

Given a flow definition (from the flow engine) and a template:

1. Walk the Liquid AST, noting every `<zl-*>` tag with its bound `name=` or `action=` attribute and the surrounding control flow (`{% if step.name == "password" %}` scopes the element to one branch).
2. For each step the flow can emit, project the template to the elements reachable in that branch.
3. Against the projected set, assert:
   - Every required entry in `fields` has exactly one matching `<zl-field name="…">`.
   - Every required entry in `gates` has exactly one matching `satisfies_gate` consumer.
   - Exactly one `<zl-submit>` is reachable.
   - Every secondary entry in `actions` has at most one matching `<zl-action>` / `<zl-sso-providers>`.
   - A trailing `{% required_atoms %}` tag is present.
   - No `<zl-*>` tags are unknown to the manifest registry.

Output is structured: `{ step_name, missing[], unknown[], duplicated[] }`. The editor surfaces these inline; `npx zitadel push` surfaces them before upload.

## Runtime safety net

`{% required_atoms %}` is a Liquid tag the built-in templates place at the end of their body. After the template finishes rendering, the tag inspects the produced DOM and appends:

- Any required `fields[*]` without a matching `<zl-field>`.
- Any required `gates[*]` without a matching consumer.
- A `<zl-submit>` if none was reached.

Appended nodes use token defaults only. Static validation should catch bad templates before ship; the tag is a last resort.

## What the validator does not check

- **Security.** Handled in [`../flowengine/template-security.md`](../flowengine/template-security.md), not duplicated here.
- Visual layout. A template may render every required element and still be ugly; that's a design concern, not a validation one.
- Performance. Expensive Liquid loops are flagged but not rejected.
- String correctness. String resources are a separate concern (see open question 8 in [`README.md`](README.md)).
- Accessibility. Part names give us a hook for an accessibility linter (separate concern, deferred).

## Frontend trigger points

Open question 7 in [`README.md`](README.md). Candidates (frontend only):

- Editor-time only (designer sees squiggles while authoring).
- `npx zitadel push` refuses to upload an invalid template.
- Both.

When the branding object reaches the component at runtime, the static validator runs once before first paint regardless of where else it ran. A failing template falls back to the nearest built-in (see [`schema.md`](schema.md) §Shape invariants).

## See also

- [`templates.md`](templates.md)
- [`../flowengine/flow-engine-nodes.md`](../flowengine/flow-engine-nodes.md)
- [`../flowengine/template-security.md`](../flowengine/template-security.md)
