# ADR 010: Passkey Action Contract

> **Status:** Proposed
> **Date:** 2026-05-12
> **Context:** Flow engine actions, WebAuthn/FIDO2, passkey authentication and registration

## Decision

Passkey (WebAuthn) registration and authentication integrate into the flow API
as **actions** and **dedicated steps** — not as gates.

### Why not gates?

Gates are pre-submit barriers (like captcha) with three properties that
conflict with passkey behavior:

1. **Auto-append safety net.** The orchestrator appends required-but-unrendered
   gates as a fallback. This works for captcha (append a widget). It doesn't
   work for passkey — conditional UI binds to the email field's autofill, and
   modal UI triggers a browser dialog. Neither can be "appended."

2. **Gates are pre-submit; passkey IS the submission.** A captcha gate works
   as: solve → fill fields → submit. The gate proof rides with the form data.
   Passkey authentication replaces the form — when the user authenticates,
   there's nothing left to submit. The orchestrator would need "gate satisfied
   → auto-submit" logic that gates weren't designed for.

3. **Conditional UI requires field coordination.** The passkey ceremony in
   autofill mode binds to the email `<input>`. Gates are supposed to be
   independent of fields.

### Passkey as action

Actions are the right model because they represent **things the user can do**
on a step. "Sign in with passkey" is an action — an alternative to "submit
email + password."

The action schema gains an optional `ceremony` property that carries
client-side ceremony configuration. When present, the orchestrator knows to
trigger a browser ceremony before submitting:

```json
"actions": {
  "submit": { "primary": true, "text_key": "login.action.submit" },
  "passkey": {
    "text_key": "login.action.passkey",
    "ceremony": {
      "type": "passkey",
      "mediation": "conditional",
      "options": { "challenge": "...", "rpId": "...", "allowCredentials": [] }
    }
  }
}
```

The orchestrator:
1. Sees `actions.passkey.ceremony.type === "passkey"`
2. Triggers `navigator.credentials.get()` (or `.create()` for registration)
3. On success, submits with `action: "passkey"` and `ceremony_proof: { ... }`

### Core design choices

1. **Actions, not gates.** Passkey is "sign in with passkey" (an action) —
   not "solve this before you can submit" (a gate). Gate stays captcha-only.

2. **`ceremony` on actions.** An optional property that tells the orchestrator
   "this action requires a client-side ceremony." Extensible to future ceremony
   types (external MFA redirects, etc.).

3. **Dedicated steps for MFA and registration.** For MFA, a `verify_passkey`
   step where the submit action has a `ceremony`. For registration, a
   `setup_passkey` step. Clean transitions — no mixed fields + ceremony.

4. **Structured JSON proof.** `ceremony_proof` on the submit request carries
   the serialized `PublicKeyCredential` response. Debuggable, schema-
   validatable, consistent with the WebAuthn ecosystem.

5. **Conditional UI via `mediation`.** `"conditional"` binds to email autofill.
   The `<zl-field>` component auto-adds `autocomplete="username webauthn"` when
   it detects a conditional passkey action on the same step.

6. **Attestation `none` by default.** Privacy-preserving. Enterprise can opt
   into `direct` via policy.

### Two authentication modes

| Mode | `allowCredentials` | User identified first? | UX |
|---|---|---|---|
| **Discoverable (conditional UI)** | `[]` | No — `userHandle` in assertion identifies user | Passkeys in email autofill dropdown |
| **Server-side** | `[{ id, transports }]` | Yes — after identifier step | Browser prompts for specific credentials |

### Conditional UI `autocomplete` (orchestrator responsibility)

The email `<input>` needs `autocomplete="username webauthn"` for conditional UI.
This is **not** a server field property — the orchestrator detects a passkey
action with `mediation: "conditional"` and applies it to the email field
automatically.

## Context

The flow engine's gate model was designed for security barriers (captcha, rate
limits). Passkey doesn't fit: it has its own ceremony lifecycle, replaces form
submission rather than gating it, and requires field coordination for
conditional UI.

The existing step response already modeled passkey as an action:
```json
"actions": { "passkey": { "text_key": "login.action.passkey" } }
```

This ADR formalizes that model and extends it with `ceremony` configuration.

See: [flow-engine.md], [flow-engine-nodes.md], [session-api.md],
[external-auth-factors.md]

## Consequences

- **`step-action.yaml`** gains an optional `ceremony` property.
- **`flow-submit-request.yaml`** gains a `ceremony_proof` field (alongside
  `fields` and `gate_proofs`).
- **`gate.yaml`** stays unchanged — `passkey` is removed from the enum.
  Gates remain captcha-only.
- **New schema files:** `passkey-config.yaml`, `passkey-proof.yaml`,
  `passkey-credential-descriptor.yaml`, `ceremony.yaml` in `components/flows/`.
- **Session factor:** `passkey` factor carries `user_verified`, `hardware`,
  `phishing_resistant`, `backup_eligible`, `backup_state` — feeding into
  assurance level schemas (AAL2/AAL3).
- **Credential management** (`/users/{id}/passkeys`) is a separate API
  surface, out of scope.

[flow-engine.md]: ../design/flowengine/flow-engine.md
[flow-engine-nodes.md]: ../design/flowengine/flow-engine-nodes.md
[session-api.md]: ../design/flowengine/session-api.md
[external-auth-factors.md]: ../design/flowengine/flow-engine-external-auth-factors.md
