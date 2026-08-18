# ADR 013: Passkey Action Contract

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

### The two-submit model

Passkey authentication is a **two-submit round-trip** through the standard
flow step progression:

```
Step 1 (login):
  actions: { submit, passkey }    ← passkey is a plain action, no options
  User clicks "Sign in with passkey"
  → POST /flow/{id}/submit { action: "passkey" }

Step 2 (passkey challenge):
  challenge: { method: "passkey", challenge_id: "ch_123", options: {...} }
  actions: { submit }
  <zl-passkey> reads step.challenge.options → triggers navigator.credentials.get()
  → POST /flow/{id}/submit { action: "submit", challenge_response: { challenge_id, method: "passkey", proof: {...} } }

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
   Liquid template. When `step.challenge.method === "passkey"`, it reads the
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
  "password": { "enabled": true },
  "passkey":  { "enabled": true }
}
```

- Policy engine uses this to determine if passkey can be required.
- The flow engine takes action ordering from the order of a step's actions in
  the flow definition, not from the schema.
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

- **`flow-step.yaml`** gains a `challenge` property (method, challenge_id,
  options).
- **`flow-submit-request.yaml`** gains a `challenge_response` field
  (challenge_id, method, proof).
- **`gate.yaml`** — `passkey` removed from enum. Gates are captcha-only.
- **`step-action.yaml`** — unchanged. Actions stay plain.
- **Session factor:** `passkey` factor carries `user_verified`, `hardware`,
  `phishing_resistant`, `backup_eligible`, `backup_state`.
- **Credential management** (`/users/{id}/passkeys`) is out of scope.

## Future Work: Conditional UI (Autofill)

The two-submit model delivers the WebAuthn challenge _after_ the user clicks
the passkey button. Conditional UI requires the challenge _on page load_ so
the browser can show passkeys in the email field's autofill dropdown.

These are compatible. The `step.challenge` property can be **pre-loaded** on
the initial step when the instance policy allows discoverable credentials:

```json
{
  "step": {
    "name": "login",
    "fields": { "email": { "type": "email", "required": true } },
    "actions": {
      "submit": { "primary": true },
      "passkey": { "text_key": "login.action.passkey" }
    },
    "challenge": {
      "method": "passkey",
      "mediation": "conditional",
      "challenge_id": "ch_pre_123",
      "options": {
        "challenge": "...", "rpId": "login.acme.com",
        "userVerification": "preferred"
      }
    }
  }
}
```

`mediation: "conditional"` tells the `<zl-passkey>` component to bind to the
email field's autofill (`autocomplete="username webauthn"`) instead of
triggering a modal. Three user paths coexist on the same step:

1. **Pick passkey from autofill** → submit with pre-loaded `challenge_response`
2. **Click passkey button** → two-submit model (fresh server-side challenge)
3. **Type email** → normal `action: "submit"` → password step

Pre-loading requires no user identification — `allowCredentials` is empty and
the assertion's `response.userHandle` identifies the user. The server decides
whether to pre-load based on the rpId policy for discoverable credentials.

This requires adding `mediation` to the `step.challenge` schema and teaching
the `<zl-passkey>` component to handle the conditional credential request
lifecycle (abort on email input focus, etc.).

[flow-engine.md]: ../design/flowengine/flow-engine.md
[flow-engine-nodes.md]: ../design/flowengine/flow-engine-nodes.md
[session-api.md]: ../design/flowengine/session-api.md
[ext-factors]: ../design/flowengine/flow-engine-external-auth-factors.md
[user-schema.md]: ../design/flowengine/user-schema.md
