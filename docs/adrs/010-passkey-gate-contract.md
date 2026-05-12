# ADR 010: Passkey Action Contract

> **Status:** Proposed
> **Date:** 2026-05-12
> **Context:** Flow engine actions, WebAuthn/FIDO2, passkey authentication and registration

## Decision

Passkey (WebAuthn) integrates into the flow API as a **plain action** that
transitions to a **challenge step**. The WebAuthn options are delivered in the
step response _after_ the user selects the passkey action — not embedded in
the action itself.

### Why not gates?

Gates are pre-submit barriers (captcha). Passkey doesn't fit:

1. **Auto-append safety net** breaks — passkey can't be appended as a widget.
2. **Gates are pre-submit; passkey IS the submission** — there's nothing left
   to submit after authenticating.
3. **Conditional UI requires field coordination** — gates are independent of
   fields.

### Why not ceremony-on-action?

Embedding WebAuthn options directly on the action (a `ceremony` property) was
considered and rejected:

1. **Stale challenges.** Options pre-generated in the step response may expire
   if the user takes time to decide.
2. **Wasted work.** If the user picks email+password, the challenge was
   generated for nothing.
3. **User must be identified first.** The server needs to know _which user_ to
   generate `allowCredentials` for. This requires a prior user factor, which
   only exists after the identifier step submits.
4. **Breaks action simplicity.** Actions are meant to be plain capabilities
   (text_key + primary). Adding protocol-specific config creates a second
   class of action.

### The two-submit model

Passkey authentication is a **two-submit round-trip** through the standard
flow step progression:

```
Step 1 (login):
  actions: { submit, passkey }    ← passkey is a plain action, no options
  User clicks "Sign in with passkey"
  → POST /flow/{id}/submit { action: "passkey" }

Step 2 (passkey challenge):
  challenge: { type: "passkey", challenge_id: "ch_123", options: {...} }
  actions: { submit }
  <zl-passkey> reads step.challenge.options → triggers navigator.credentials.get()
  → POST /flow/{id}/submit { action: "submit", challenge_response: { challenge_id, passkey: {...} } }

Step 3 (done):
  complete: "redirect"
```

The flow engine internally calls `svc.IssueChallenge(method: "passkey")` when
processing the passkey action — no HTTP round-trip from the client to
`auth_attempts`. The client only talks to `/flow/{id}/submit`.

### Key design choices

1. **Plain actions.** Passkey is a regular action — same shape as submit or
   register. No embedded WebAuthn config. The template renders it as
   `<zl-passkey>` (invisible) or as a button via `<zl-action>`.

2. **Challenge on the step.** After the user submits the passkey action, the
   server responds with a new step containing `step.challenge` — the WebAuthn
   options generated on-demand by the auth_attempts service.

3. **`<zl-passkey>` component.** An invisible Lit web component mounted by the
   Liquid template. When `step.challenge.type === "passkey"`, it reads the
   options, triggers the browser's credential API, and auto-submits the proof.

4. **`challenge_response` on submit.** The proof goes in a `challenge_response`
   field on the submit request, alongside `challenge_id` and `method`. This
   mirrors the auth_attempts challenge/verify contract.

5. **Attestation `none` by default.** Privacy-preserving. Enterprise can opt
   into `direct` via policy.

6. **Structured JSON proof.** The `passkey` proof in `challenge_response` is a
   JSON object matching the WebAuthn JSON serialization spec — debuggable,
   schema-validatable, compatible with go-webauthn.

### User schema integration

Passkey availability is declared via `x-auth-methods` on the user schema:

```json
"x-auth-methods": {
  "password": { "enabled": true, "position": 1 },
  "passkey":  { "enabled": true, "position": 0 }
}
```

- Policy engine uses this to determine if passkey can be required.
- Flow engine uses `position` for action ordering hints.
- The credential itself is stored off-schema, registered via auth_attempts.

## Context

The flow engine's gate model was designed for security barriers (captcha).
Passkey doesn't fit. The existing step response already modeled passkey as a
plain action:

```json
"actions": { "passkey": { "text_key": "login.action.passkey" } }
```

The auth_attempts service already has a challenge/verify model for passkey:
- Issue: `POST /auth_attempts/{id}/challenges { method: "passkey" }`
- Verify: `POST /auth_attempts/{id}/challenges/{cid}/verify { passkey: {...} }`

This ADR formalizes the flow API contract that connects these pieces: the flow
engine drives auth_attempts internally, and the challenge/proof travel through
the step response and submit request.

## Consequences

- **`flow-step.yaml`** gains a `challenge` property (type, challenge_id,
  options).
- **`flow-submit-request.yaml`** gains a `challenge_response` field
  (challenge_id, method, passkey proof).
- **`gate.yaml`** — `passkey` removed from enum. Gates are captcha-only.
- **`step-action.yaml`** — unchanged. Actions stay plain.
- **New schema file:** `passkey-proof.yaml` (serialized PublicKeyCredential).
- **Session factor:** `passkey` factor carries `user_verified`, `hardware`,
  `phishing_resistant`, `backup_eligible`, `backup_state`.
- **Credential management** (`/users/{id}/passkeys`) is out of scope.
- **Conditional UI (autofill)** is deferred — requires challenge on page load,
  which conflicts with the two-submit model. Future work may add a pre-loaded
  challenge mechanism for this.

[flow-engine.md]: ../design/flowengine/flow-engine.md
[flow-engine-nodes.md]: ../design/flowengine/flow-engine-nodes.md
[session-api.md]: ../design/flowengine/session-api.md
[ext-factors]: ../design/flowengine/flow-engine-external-auth-factors.md
[user-schema.md]: ../design/flowengine/user-schema.md
