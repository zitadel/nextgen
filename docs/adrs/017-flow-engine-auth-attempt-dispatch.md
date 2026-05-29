# ADR 017: Flow Engine Auth-Attempt Dispatch for Signin vs Signup

> **Status:** Draft
> **Date:** 2026-05-29
> **Context:** Flow engine, auth-attempts, signup/signin/recovery/SSO flows

## Context

The flow engine drives the auth-attempt service for two purposes:

* **Verify** existing identifiers and credentials (signin path).
* **Establish** new identifiers and credentials (signup / recovery / link path).

Today the [`FlowStateMachineRuntime.dispatchChallenges`][dispatch] loop runs each
field-shaped challenge (`identifier`, `password`) whenever the corresponding
field is present in the submission, with a single carve-out:

```go
if step.OnSuccess != nil && *step.OnSuccess == FlowOnSuccessCreateUser {
    return flowDispatchResult{}, nil
}
```

This works for the flows we have today:

* **Pure signin** — identifier field on one step, password field on the next. Both dispatch as verification.
* **Combined signin/signup with an `identify` step** — `user_not_found` is wired on `identify`, so the identifier challenge routes correctly. The `set_password` step that creates the user has `on_success: create_user` and is skipped wholesale.

It does **not** work in two cases we want to support:

1. **Multi-step signup where the identifier is collected before the `create_user` step.** Example: `profile(email, given_name)` → `set_password(password, on_success: create_user)`. The `profile` step would call `SubmitIdentifier(email)`, get `user_not_found`, and fail to route because `profile` doesn't declare a `user_not_found` transition. There is no signin branch — this is a registration-only flow.
2. **Non-password credentials.** Passkey, magic link, OTP, and SSO are not field-shaped. Their proofs travel through `PendingChallenge` or SSO callbacks, not `data.field`. The `create_user`-keyed skip also doesn't generalize to writers that establish those credentials (`create_user_with_passkey`, `link_sso`, `reset_credential`, …).

## Problem statement

Decide how a step opts in or out of:

* **Identifier resolution** — does the engine call `SubmitIdentifier` and route on `user_not_found` / other resolution outcomes, or is the field collected as plain data?
* **Credential verification** — does the engine verify the submitted credential against an existing one, or is the value handed to an `on_success` writer that establishes it?

The control signal must work for:

* Signin-only flows.
* Signup-only flows (single-step and multi-step).
* Combined-purpose flows (a single definition serving `login` and `register`).
* Recovery flows that establish a new credential without verifying the old one.
* SSO flows where identity resolution is a mandatory side-effect of the IdP exchange.
* Future credential kinds (passkey, magic link, OTP) without re-touching the dispatch loop.

## Options considered

### Option 1 — Purpose-based gating

Skip auth-attempt verification when `flow.purpose == register`.

* **Pros:** Trivial to implement.
* **Cons:** Purpose is set once at flow start. A combined-purpose flow (`["login", "register"]`) has a single purpose for the whole lifetime, so identifier resolution either always runs or never runs. Kills the combined-flow pattern.

**Rejected.**

### Option 2 — Implicit graph reading (`user_not_found` transition)

Dispatch the identifier challenge if and only if the current step declares a
`user_not_found` transition. Absence of the transition means "collect-only".

* **Pros:** Author writes nothing extra — the routing intent and dispatch intent are the same edge. Symmetric with the existing `implicitOutcomesByChallenge` map. Combined flows fall out naturally.
* **Cons:** **The dispatch behavior is hidden in a transition key.** A reader who removes or renames the `user_not_found` transition does not realize they are also turning off identifier resolution. The control signal is buried in a routing table and is not discoverable from the step shape. Also: SSO needs lookup to *always* run, so this rule only applies to field-shaped identifiers (see Option 5 below).

**Concern raised: implicitness.** Not preferred as the source of truth.

### Option 3 — Explicit step property

Add a step-level property that names the step's intent for each challenge kind:

```json
{
  "name": "profile",
  "fields": ["email", "given_name"],
  "identifier": "collect",       // "verify" | "collect"
  "transitions": { "submit": { "target": "set_password" } }
}
```

```json
{
  "name": "identify",
  "fields": ["email"],
  "identifier": "verify",
  "transitions": {
    "submit":         { "target": "signin" },
    "user_not_found": { "target": "profile" }
  }
}
```

* **Pros:** Dispatch behavior is local to the step and visible at a glance. Renaming or removing a transition does not silently change dispatch. Generalizes per challenge kind (e.g., `credential: "verify" | "establish"`) without depending on a writer manifest.
* **Cons:** Two sources of truth — the property must agree with what the transitions allow (`identifier: "verify"` without a `user_not_found` transition is a definition-validation error). One more knob the author has to set.

**Preferred direction for the identifier-side decision.**

### Option 4 — `on_success` writer manifest (credential side)

Each `FlowOnSuccess` value carries a manifest of which credential kinds it
establishes:

```
create_user              → { identifier, password }
create_user_with_passkey → { identifier, passkey }
create_user_with_sso     → { identifier, sso }
link_sso                 → { sso }
reset_credential         → { password }
```

The dispatch loop, for any challenge kind on a step, asks: "does the step's
`on_success` establish this kind?" If yes, the handler owns it — skip
verification. If no, run as verification.

* **Pros:** Generalizes the existing `create_user` carve-out to any writer. The writer is the natural place to declare what it produces. New credential kinds (passkey, OTP) need only register their writer — no change to the dispatch loop. Explicit at the registry level, even if not at the step level.
* **Cons:** Manifest must stay in sync with the writer's actual behavior. Slightly indirect — to know what a step does with a credential, the reader has to look up the `on_success` value's manifest.

**Preferred direction for the credential-side decision.**

### Option 5 — Split rules by identifier shape (SSO refinement)

Identifier resolution behaves differently depending on whether the identifier
arrives as a form field or as a ceremony output (SSO claims, future federated):

* **Field-shaped identifier** — lookup is optional. The author opts in via Option 3's explicit `identifier: "verify"` (or the implicit Option 2 if we keep it).
* **Ceremony-shaped identifier** — lookup is mandatory because the verified claims must bind to a user (existing or new) before the flow can proceed. The step's transitions select route-vs-error for each engine-emitted outcome (`user_not_found`, `user_link_required`, etc.).

* **Pros:** Acknowledges that SSO is not optional — you can't "collect" a verified IdP identity and defer resolution. Keeps the same vocabulary (`user_not_found` transition, etc.) but with different defaults per shape.
* **Cons:** Two sub-rules instead of one. Author has to know which shape they're dealing with.

**Required regardless of which other options win.**

### Option 6 — Expand identifier-resolution outcomes

The engine emits more than `user_not_found`. Today the binary find / not-found
is enough; SSO surfaces a third case:

| Outcome | Meaning |
|---|---|
| (success) | Identifier resolved to a user |
| `user_not_found` | No user matches |
| `user_link_required` | User exists by email but no external-identity link (SSO only) |
| `user_locked` (future) | User found but disabled |

Each is a routing outcome. Wired → route. Unwired → error.

* **Pros:** Avoids silent auto-link takeover (a takeover vector if `user_link_required` were merged with success). Scales to future cases.
* **Cons:** More outcome names for authors to learn. Definition validation should warn on unwired outcomes for SSO steps so authors don't accidentally fall through to an error.

**Required for SSO.**

## Worked examples

These flows illustrate Options 3 + 4 + 5 + 6 acting together. Where Option 3's
`identifier` property is shown, it is the explicit replacement for Option 2's
implicit transition-based gating.

### A. Multi-step password signup

```json
{
  "slug": "signup-password",
  "purposes": ["register"],
  "initial_steps": { "register": "profile" },
  "steps": [
    {
      "name": "profile",
      "fields": ["email", "given_name"],
      "identifier": "collect",
      "transitions": { "submit": { "target": "set_password" } }
    },
    {
      "name": "set_password",
      "fields": ["password"],
      "on_success": "create_user",
      "transitions": { "submit": { "target": "done" } }
    },
    { "name": "done", "complete": "show" }
  ]
}
```

* `profile`: `identifier: "collect"` → no identifier dispatch. Email is collected for the writer.
* `set_password`: `on_success: create_user` manifest establishes `{identifier, password}` → password dispatch skipped. Writer reads `email + password` from `CollectedData`, persists, reports factors.

### B. Multi-step passkey signup

```json
{
  "name": "register_passkey",
  "gates": { "passkey": { "type": "passkey", "mode": "register" } },
  "on_success": "create_user_with_passkey",
  "transitions": { "submit": { "target": "done" } }
}
```

The same manifest mechanism decides ceremony mode: `create_user_with_passkey`
establishes `{passkey}`, so the WebAuthn ceremony is `register`, not `verify`.

### C. Combined signin/signup

```json
{
  "name": "identify",
  "fields": ["email"],
  "identifier": "verify",
  "transitions": {
    "submit":         { "target": "signin" },
    "user_not_found": { "target": "profile" }
  }
}
```

`identifier: "verify"` requires a wired resolution outcome (`user_not_found`) at
definition-validation time. The signin and signup branches share an entry step.

### D. SSO with auto-provision and link prompt

```json
{
  "name": "login",
  "sso_providers": [{ "id": "google", "name": "Google" }],
  "transitions": {
    "google":             { "target": "sso_redirect" },
    "callback":           { "target": "done" },
    "user_not_found":     { "target": "provision" },
    "user_link_required": { "target": "verify_existing" }
  }
}
```

Ceremony-shaped identifier (Option 5): lookup always runs after the IdP
exchange. Each emitted outcome must be wired or the engine errors (Option 6).
The `provision` step pre-fills from verified claims, has `on_success:
create_user_with_sso`, and is `identifier: "collect"` because the IdP already
verified the identity.

### E. Recovery

```json
{
  "name": "new_password",
  "fields": ["password"],
  "on_success": "reset_credential",
  "transitions": { "submit": { "target": "done" } }
}
```

Manifest entry `reset_credential → {password}` skips password verification —
the writer rewrites the credential without comparing it against the old one.
Different writer from `create_user`, same rule.

## Open questions

* **Is the explicit step property per challenge kind (`identifier`, `credential`) or a single intent enum (`step_role: "verify" | "collect" | "establish"`)?** Per-kind is more flexible (a step could verify an identifier while establishing a credential). Single enum is shorter and disallows ambiguous shapes by construction. Lean: per-kind, paired with definition-validation that rejects nonsensical combinations.
* **Should Option 2 (implicit transition reading) survive as a *default* with Option 3 as the override?** That is, "if no `identifier` property is set, infer from `user_not_found` presence." Concern: defeats the explicitness goal. Lean: no — require the property and have the validator reject ambiguous steps.
* **Where does the writer manifest live?** Options: (a) a Go-side map next to `FlowOnSuccess` enums, (b) a method on each `FlowOnSuccessHandler` (`EstablishedKinds() []FlowFieldChallenge`), (c) a registry the state machine builds at wiring time. Lean: (b) — the writer owns the truth about what it produces.
* **Definition validation surface.** Adding `identifier: "verify"` without a `user_not_found` transition, or `identifier: "collect"` on a step whose `on_success` does not consume the field — both should be caught at activation, not at runtime. Belongs in [`flow_definition_validator.go`][validator].
* **Anti-enumeration in recovery.** Flow D in the discussion routed both `submit` and `user_not_found` to the same `verify_link` target on the `identify` step. The explicit property still applies (`identifier: "verify"`), and the writer's behavior is unchanged. Worth a test in the validator to make sure same-target outcomes aren't flagged as dead.
* **`AuthAttempt` and the no-user terminate path.** The current `terminate` skips handoff when `_user_id` isn't in `CollectedData` (see `flow_state_machine.go:430`). Once writers always report their established factors, the policy engine populates `RequiredChecks` and that special case goes away. Track separately.

## Direction (not a decision)

Lean toward:

* **Option 3** (explicit `identifier` step property) — replaces Option 2's implicit transition reading. Authors declare intent locally; validators enforce consistency with transitions.
* **Option 4** (writer manifest via handler method) — generalizes the `create_user` carve-out to every writer; new credential kinds extend via new writers without touching dispatch.
* **Options 5 and 6** apply on top regardless — SSO needs them and they don't conflict with 3 + 4.

To be confirmed before promoting from Draft.

## Consequences

* **`FlowDefinitionStep`** gains an `Identifier` (and likely `Credential`) property; OpenAPI schema in `api/openapi/components/flows/` mirrors it.
* **`FlowOnSuccessHandler`** grows a method declaring established credential kinds; runtime `dispatchChallenges` consults it.
* **`flow_definition_validator.go`** gains rules cross-checking the new properties against transitions and `on_success`.
* **Identifier-resolution outcome set** grows beyond `user_not_found`; `implicitOutcomesByChallenge` and the runtime's emission paths track the additions.
* **No purpose-based branching is introduced.** All control flows from the graph and the writer manifest.

[dispatch]: ../../internal/domain/flow_state_machine.go
[validator]: ../../internal/domain/flow_definition_validator.go
