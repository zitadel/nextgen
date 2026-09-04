# ADR 017: Flow Engine Auth-Attempt Dispatch for Signin vs Signup

> **Status:** Draft
> **Date:** 2026-06-01
> **Context:** Flow engine, auth-attempts, signup/signin/recovery flows

## Context

The flow engine drives the auth-attempt service to either *verify* existing
identifiers and credentials (signin) or *establish* new ones (signup,
recovery, link). Today the engine assumes verify by default and only suppresses
dispatch when the current step's `on_success` is exactly `create_user` — the
single signup mutation that exists. That heuristic handles two shapes: pure
signin (everything verifies) and single-step signup where the identifier and
the password are collected on the same step that runs `create_user`.

It breaks for the shapes we want next:

1. **Multi-step signup, identifier collected before `create_user`.** The
   collecting step runs identifier resolution, gets `user_not_found`, and has
   no route for that outcome because it isn't supposed to fork — it's
   supposed to keep collecting.
2. **Multi-step signup, credential collected before `create_user`.** The
   suppression rule fires only on the step that owns `on_success`. An earlier
   `set-password` step still tries to verify the password against a user that
   doesn't yet exist.
3. **Mutations other than `create_user`.** Passkey signup and password reset
   are different mutations, but the suppression rule only knows one name.

The engine needs two separate answers, derived from per-flow rather than
per-step state: *should this collected field be verified or just collected*,
and *which credential kinds will the eventual mutation produce*.

## Decision

Two mechanisms cover verify-vs-establish for every shape.

### 1. Dynamic dispatch mode (`CurrentPurpose`)

`FlowState` gains `CurrentPurpose`, distinct from the authoring `Purpose`
(`Purpose` records what the client / OIDC asked for and is read by telemetry,
policy, and ACR — it stays pinned at start). `CurrentPurpose` is initialised
from `Purpose` and updated by the engine on identifier outcomes:

| From | Outcome | To |
|---|---|---|
| `login` | `user_not_found` | `register` |
| `register` | `user_already_exists` | `login` |
| `recovery` | — | (no flip) |

The flip is automatic; the author must still wire the outcome's transition,
otherwise the engine errors. The UI is responsible for any copy change when
mode flips (e.g. "This email is already registered — sign in to continue"
on a `signin-password` step reached via `user_already_exists`).

Credential dispatch reads `CurrentPurpose`:

| `CurrentPurpose` | Credential dispatch |
|---|---|
| `login` | verify |
| `register` | skip — mutation establishes |
| `recovery` | skip — mutation establishes |

Identifier dispatch is not gated by `CurrentPurpose`; it runs whenever a field
has `x-unique` and the attempt has no user check yet, in order to emit routing
outcomes.

### 2. Mutation manifest

`CurrentPurpose` decides *whether* the engine verifies a collected credential.
It doesn't say *what* a given mutation consumes when it runs — that's a
property of the mutation, not the flow. Each `FlowOnSuccessHandler` declares
its manifest:

```go
type FlowOnSuccessHandler interface {
    Handle(ctx, ...) (FlowOnSuccessResult, error)
    EstablishedKinds() []FlowFieldChallenge
}
```

| Mutation | Manifest |
|---|---|
| `create_user` | `{identifier, password}` |
| `create_user_with_passkey` | `{identifier, passkey}` |
| `reset_credential` | `{password}` |

The manifest enumerates *credential kinds* — the things the engine has a
verify-or-establish opinion about (`identifier`, `password`, future
`passkey`). Plain user attributes (`given_name`, `family_name`, …) are not
in scope: they have no auth-attempt dispatch, are validated against the user
schema directly, and reach the mutation through `CollectedData` keyed by
schema property. `identifier` appears in the manifest when the mutation
binds a new one (so `create_user` has it; `reset_credential` does not).

Three things rely on this declaration:

* **Mutation consumption.** The mutation pulls collected credentials per its
  manifest (per ADR 020, `CollectedCredentials` keyed by kind) and reads
  whatever attributes it needs from `CollectedData`.
* **Definition validator.** A flow running `create_user` must collect both
  manifest entries upstream — identifier and password. Required schema
  attributes (`given_name`, etc.) are checked separately against the user
  schema, not the manifest.
* **Extending the engine.** New credential kinds add a mutation with its
  manifest. The dispatch loop and validator are untouched; no name-based
  carve-outs accumulate.

Together with `CurrentPurpose`, this removes the hard-coded `create_user` skip
in today's `dispatchChallenges`: mode decides verify-or-skip, the manifest
decides what the mutation will consume.

## Worked examples

### A. Multi-step signup, user created after the password

```yaml
purposes:
  register: profile
steps:
  - name: profile
    fields: [email, given_name]
    transitions:
      submit: { target: set-password }
  - name: set-password
    fields: [password]
    transitions:
      submit: { target: confirm-email }
  - name: confirm-email
    fields: [otp]
    on_success: create_user
    transitions:
      submit: { target: done }
  - name: done
    complete: show
```

`CurrentPurpose=register` from start. `profile` runs `SubmitIdentifier`, gets
`user_not_found` (expected for a register entry). `set-password` collects
without dispatching — mode is register. `confirm-email` runs `create_user`,
which reads from collected state per its manifest. User lives on a different
step from the password.

### B. Multi-step signup, user created on the password step

```yaml
purposes:
  register: profile
steps:
  - name: profile
    fields: [email, given_name]
    transitions:
      submit: { target: set-password }
  - name: set-password
    fields: [password]
    on_success: create_user
    transitions:
      submit: { target: done }
  - name: done
    complete: show
```

Same mode behaviour; the mutation just happens to ride on the password step.

### C. Combined signin/signup

```yaml
purposes:
  login: identify
  register: identify
steps:
  - name: identify
    fields: [email]
    transitions:
      submit:              { target: signin-password }
      user_not_found:      { target: register-password }
      user_already_exists: { target: signin-password }
  - name: signin-password
    fields: [password]
    transitions:
      submit: { target: done }
  - name: register-password
    fields: [password]
    on_success: create_user
    transitions:
      submit: { target: done }
  - name: done
    complete: redirect
```

Login entry, known email → identifier verifies → `signin-password` verifies.
Login entry, unknown email → `user_not_found` → engine flips
`CurrentPurpose=register` → `register-password` collects without dispatch →
`create_user` runs. Register entry, existing email → `user_already_exists` →
engine flips `CurrentPurpose=login` → `signin-password` verifies normally.

### D. Recovery

```yaml
purposes:
  recovery: identify
steps:
  - name: identify
    fields: [email]
    transitions:
      submit: { target: new-password }
  - name: new-password
    fields: [password]
    on_success: reset_credential
    transitions:
      submit: { target: done }
  - name: done
    complete: show
```

`CurrentPurpose=recovery` throughout. Identifier verifies; credential dispatch
skipped. `reset_credential` rewrites the credential.

## Alternatives considered

* **Static purpose gating.** `Purpose` is pinned at start, so combined-purpose flows would either always verify or never verify. Resolved by making the dispatch flag dynamic and separate from authoring intent.
* **Implicit transition reading** (dispatch iff `user_not_found` is wired). Hides the control signal in a routing edge.
* **Per-kind step properties** (`identifier: "verify" | "collect"`, `credential: "verify" | "establish"`). Explicit but verbose. Held in reserve if the outcome → flip table grows or authors frequently need per-step exceptions.

## Open questions

* **Outcome → flip table location.** Engine-hard-coded is discoverable but each addition is a code change. Per-transition (`set_mode: register`) is data-driven but reintroduces implicitness. Lean: hard-coded.
* **Telemetry purpose.** A login flow that flipped to register reports completion under which? Lean: `Purpose` for requested intent, separate metric for `CurrentPurpose` at completion.

## Consequences

* `FlowState` gains `CurrentPurpose`, persisted in the `_zflow` cookie.
* `FlowOnSuccessHandler` grows `EstablishedKinds() []FlowFieldChallenge`; the `FlowOnSuccessCreateUser` carve-out is removed.
* `dispatchChallenges` keys on `(CurrentPurpose, challengeKind)` plus the current step's mutation manifest.
* Identifier outcomes grow: `user_already_exists`, future `user_locked`.
* `flow_definition_validator.go` cross-checks entry purposes against the flip table and mutation manifests against fields actually collected upstream.
* No new step properties.

## Passkey

Passkey is on the MVP track. It composes with the two mechanisms above with
specifics worth recording.

**Action-shaped, not field-shaped.** Per ADR 020, a passkey step triggers the
ceremony through `actions.<name>.auth_method: passkey`, not via a token in
`fields[]`. The flow's `PendingChallenge` threads the WebAuthn challenge ID
through the encrypted cookie; the matching submit routes to the passkey
service for verification (login mode) or enrolment (register mode). The
action descriptor's `auth_method` is what links the button back to
`x-auth-methods.passkey` in the user schema. `fields: [x-auth-methods-passkey]`
is invalid and the validator rejects it.

**Two shapes with different identifier semantics.**

* *Identifier-then-passkey.* User collects an identifier first (typically
  email); the passkey ceremony runs against the resolved user. `SubmitIdentifier`
  fires as usual; `CurrentPurpose` decides whether the ceremony is
  `webauthn.get` (login mode) or `webauthn.create` (register mode). No new
  mechanism — fits the existing model directly.
* *Identifier-less passkey* (conditional UI / discoverable credentials). No
  identifier is collected up front; the assertion's `userHandle` identifies
  the user retroactively. Identifier resolution is folded into ceremony
  verification — `SubmitIdentifier` does not run, no `user_not_found` outcome
  is emitted, and no flip signal exists. Entry `Purpose` must match the
  user's intent from the start; combined `login`/`register` on an
  identifier-less entry step is not expressible under the current model and
  the validator rejects it.

**Mutation manifest.** `create_user_with_passkey` carries
`{identifier, passkey}`. The identifier (usually email) is still required —
schema-required attributes don't disappear because the credential kind
changed. A flow that wants pure passkey-only signup must collect or generate
an identifier on an earlier step; the schema's `required[]` is unchanged.

**Validator rules added for passkey:**

* An action with `auth_method: passkey` requires the user schema's
  `x-auth-methods.passkey.enabled: true`.
* `fields[]` may not contain `x-auth-methods-passkey` (passkey is action-shaped
  per ADR 020).
* An identifier-less entry step with combined purposes is rejected.
* A step running `create_user_with_passkey` must have an identifier collected
  somewhere upstream (manifest cross-check).

**Deferred: combined "Sign in or Register with passkey".** A single
identifier-less entry that handles both directions would need a
`credential_unknown` outcome on the ceremony to flip
`CurrentPurpose=login` → `register`, analogous to `user_not_found` on
identifier resolution. Out of scope for the initial passkey landing;
revisit when discoverable-credentials UX is in scope.

## Note: SSO

SSO ceremonies are out of MVP scope. When they land, the model extends without
reshaping: ceremony-shaped identifiers (IdP callbacks) always run resolution;
the engine emits an additional outcome (`user_link_required`) that authors
wire; the manifest gains `create_user_with_sso` and `link_sso`; the `purposes`
enum gains `link_account` (with `user_not_found` flipping it to `register`).
The two mechanisms decided above accommodate this without change.

**Amendment (#851, social login).** Ceremony resolution does not reuse
`user_not_found` for an unknown subject. A shared entry step hosts both the
typed identifier and the provider buttons, and one transition key has one
target, so `user_not_found` keeps its typed-identifier route and a new
outcome, `identity_unknown`, routes the unknown SSO subject to the collection
step. It flips `CurrentPurpose` from `login` to `register` exactly as
`user_not_found` does. `user_link_required` is not added: account linking is
out of scope for #851, and the outcome returns with the linking journey. See
[Resolution Branches](../design/idp/3-social-login-flow.md#resolution-branches).

[dispatch]: ../../internal/domain/flow_state_machine.go
[validator]: ../../internal/domain/flow_definition_validator.go
