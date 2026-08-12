# ADR 026: Flow Action Kind

> **Status:** Accepted
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
    - { name: register, kind: navigate }
  transitions:
    submit:         { target: password }
    passkey:        { target: done }
    register:       { target: register, purpose: register }
    user_not_found: { target: register }
```

- Clicking `submit` validates the email, dispatches the identifier lookup, and follows `transitions.submit`.
- Clicking `passkey` runs the ceremony.
- Clicking `register` just navigates — the empty email box doesn't trigger a validation error, because `navigate` skips the input pipeline entirely. Its transition carries a local `purpose` (see the amendment below) so the register leg runs with register semantics. A definition that keeps registration in a separate flow would use `{ target: default-register, action: switch }` instead.

### State on navigation

A plain `navigate` action does not touch the state machine's input
memory. It does abandon a pending ceremony: any `PendingChallenge` (an
issued passkey prompt the user walked away from) is cleared when a
navigate action fires, so the stale challenge cannot re-attach on the
next render.

**Purpose-changing navigation is stricter.** When the transition declares
a `purpose` (see the amendment below), the engine additionally purges
user-bound state — the resolved user id, collected password material, and
the provisional passkey marker — and, if a user had been resolved,
rotates the auth attempt (the persisted attempt carries the user as a
factor and refuses a second user challenge). Collected non-credential
field values (e.g. the typed email) survive for prefill. Toggling between
purpose entries is coalesced as an undo of the previous navigation, so
the flow-state cookie stays bounded no matter how often the links are
clicked.

### Amendment (2026-08-11): local `purpose` on transitions

A transition may declare a `purpose`:

```yaml
transitions:
  register: { target: register, purpose: register }
```

Taking it sets the flow state's `CurrentPurpose` — the dispatch mode a
step's challenges run under (verify vs. skip, `on_success` semantics) —
while the flow's original pinned `Purpose` stays untouched (telemetry and
ACR read the pinned value). This is what makes an in-card "Sign up" link
on a combined login/register definition semantically correct: without it,
navigation reaches the registration step while the engine still dispatches
in login mode.

Constraints, enforced by the definition validators (Go and the ported
`@zitadel/config` validator):

- `purpose` must be one the definition serves (a key of `purposes`).
- `target` must be that purpose's configured entry step. This fence keeps
  re-purposing equivalent to "start this purpose from its entry"; it can
  be loosened later if a real flow needs mid-flow entry.
- `purpose` is mutually exclusive with `action`: `switch`/`pivot` target
  **another flow definition** — that contract is unchanged, and a
  transition either re-purposes locally or leaves the flow, never both.

The implicit outcome flips (`user_not_found`, `user_already_exists`)
remain; a declared transition purpose wins over the flip when both apply.
Back navigation needs no amendment: the back stack already snapshots the
purpose per entry (ADR 022), so `back` across a re-purposing transition
restores the previous purpose.


### Engine-injected actions

The engine may inject actions derived from other declarations,
and those injected actions carry a `kind` set by the engine — not by the
author. The only example today is the `back` action from
[ADR 022](022-flow-back-navigation.md).

`back` is `kind: navigate`. It does not revert collected input — but it
does restore the step and the purpose snapshotted in the back stack
(ADR 022), which is how back across a re-purposing transition returns to
the previous purpose.

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
