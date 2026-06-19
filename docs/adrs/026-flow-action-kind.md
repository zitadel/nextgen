# ADR 026: Flow Action Kind

> **Status:** Proposed
> **Date:** 2026-06-16
> **Context:** Flow engine action dispatch, `<zitadel-login>` orchestrator, flow definitions

## Decision

Every `action` declared on a flow step should define a `kind`. The `action` `kind` is used to differentiate
request that are supposed to process and advance the state machine versus actions that are navigation only.

`kind` is a closed enum: `submit`, `passkey`, `passkey_register` and `navigate` (new behavior).

### Example

A login step that lets the user sign in, switch to passkey, or jump to
registration:

```yaml
- name: identifier
  fields: [email]
  actions:
    - { name: submit,   kind: submit, primary: true }
    - { name: passkey,  kind: passkey }
    - { name: register, kind: navigate } # currently this not possible, because it would expect the `email` to be submitted
  transitions:
    submit:         { target: password }
    passkey:        { target: done }
    register:       { target: default-register, action: switch }
    user_not_found: { target: register }
```

- Clicking `submit` validates the email, dispatches the identifier lookup, and follows `transitions.submit`.
- Clicking `passkey` runs the ceremony.
- Clicking `register` just navigates — the empty email box doesn't trigger a validation error, because `navigate` skips the input pipeline entirely.

### State on navigation

A `navigate` action does not touch the state machine's input memory. 

### Engine-injected actions

The engine may inject actions derived from other declarations,
and those injected actions carry a `kind` set by the engine — not by the
author. The only example today is the `back` action from
[ADR 022](022-flow-back-navigation.md).

`back` is `kind: navigate` with no state-revert semantics.

## Context

Today every action submitted to `POST /flow/{id}/submit` runs the same pipeline —
validate fields, dispatch to auth-attempts, run `on_success`. There is no way to
declare an action as navigation-only.

Concrete consequence: a login step can't offer a "Register" link next to its submit
button. Clicking the link with an empty email field fails validation instead of
switching to the registration flow.

The engine already special-cases a few action names (`submit`, `passkey`,
`passkey_register`, `sso`) but that rule is invisible — a flow author reading the
flow definition has no way to tell which actions process input and which just
navigate, except by knowing the reserved-name set.

## Alternatives Considered

### 1. Reserve `submit` (plus `passkey`, `passkey_register`, `sso`) as engine-handled action names; treat any other name as navigation by default

No new fields on the action declaration; the engine looks at the name and
decides.

**Rejected:** Implicit. An author has to know the reserved set to predict
behavior, and the rule is invisible in the flow definition itself. Renaming
`submit` to `continue` would silently break input processing.

### 2. Split actions into two top-level surfaces — `actions` (input-processing) and `links` (navigation-only)

```yaml
actions:
  - { name: submit, primary: true }
links:
  - { name: register, target: default-register, action: switch }
```

**Rejected:** Two surfaces to validate, two places to look up "what does this
button do". Routing becomes asymmetric — `actions` route through `transitions`,
`links` carry `target` inline. Engine-handled ceremonies (`passkey`,
`passkey_register`) don't fit cleanly into either bucket. A typed `kind` on a
single surface captures the same distinction without the split.

### 3. Default `kind` to `submit` if omitted

Compatibility-friendly: existing definitions keep working.

**Rejected:** Defaults are exactly the implicit behavior this ADR is trying to
remove. We are in MVP with a small number of flow definitions; a one-shot
contract change is cheaper than living with the default.
