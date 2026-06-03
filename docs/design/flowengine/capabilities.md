# Flow Engine — Capabilities

> **Status:** Current
> **See also:** [Architecture](architecture.md) · [Definition Rules](flow-definition-rules.md) · [Flow Engine](flow-engine.md)

What the engine can do today, what is stubbed (returns a recognizable error),
and what is not built yet. Update this file alongside the engine — its job is
to be a fast answer to "can I build flow X right now?"

## Today

### Flow lifecycle

- `POST /flow` — mint a fresh flow handle, return the first step.
- `POST /flow/{id}/submit` — advance the state machine; rotate the cookie.
- `GET /flow/{id}` — re-render the current step without advancing.
- Encrypted `_zflow` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, 600s max-age).
- Cookie cleared on terminal step.
- Step error mode: same step re-rendered with `Error` set; cookie rotates to prevent replay.
- Cookie-cookie / cookie-id / cookie-expiry mismatch errors mapped to 401 / 404 / 410.

### Resolution

- Direct lookup by `name` (with optional `schema_version`).
- Audience-based resolution by `purpose` plus active `status`.
- Picks the highest `schema_version` when multiple matches.
- Fails with `ErrFlowDefinitionPurposeMismatch` when a name-resolved definition doesn't serve the requested purpose.

### Definitions

- `FlowDefinitionRepository` over Postgres and Spanner.
- Status enum: `draft`, `active`, `deprecated`, `archived`.
- Per-definition `user_schema` URL, captured into `FlowState` at `Start`.

### Steps & state machine

- Schema-driven `fields`: type, validation, `required`, uniqueness scope, challenge mapping from `x-unique` / `x-password` annotations.
- `actions` — user-selectable, surfaced on the capability payload.
- `on_success: create_user` — hashes the password, writes the user and credential rows. Pure side effect: does not authenticate the new user, so the engine keeps walking the graph and does not mint a handoff.
- `complete: redirect` and `complete: show` — terminal step classifiers.
- Implicit identifier resolution from any identifier-shaped field; routes via `user_not_found` when wired, errors otherwise.
- Implicit password verification when a password-shaped field is present and `on_success` is not `create_user`.
- Step error path: validation failures and password rejection re-render the current step with `Error` set; the state machine does **not** advance.
- Terminal-step handoff: when a user has been resolved, calls `auth-attempt.Handoff` and returns the token + expiry on `FlowStepResult`.

### Step response shape

- `name`, `texts` (`title_key`, `description_key`), optional `error`, optional `complete`.
- `fields` map keyed by name, per-field `type` / `text_key` / `required` / optional `value` / optional `validation`.
- `actions` map with `text_key` and `primary` flag. Actions are unordered — the LiquidJS template decides layout.
- `gates` and `sso_providers` are part of the contract but not yet emitted with content (see below).

## Stubbed (returns `ErrUnsupported`)

These contracts exist on the wire and in the state machine but reject at runtime:

- **Cross-flow transitions.** `transitions.target` with `action: "pivot"` or `action: "switch"` is rejected. `PivotStack` is defined on `FlowState` but never pushed.
- **SSO submissions.** Submitting an action with an `sso_provider_id` is rejected.
- **Gate proofs.** Submitting a `gate_proofs` map is rejected.

`ErrUnsupported` maps to HTTP 400 with `code: "unsupported"`.

## Missing

Not implemented at any layer:

### Auth methods

- Passkey (WebAuthn) registration and verification ceremonies — see [ADR 013](../../adrs/013-passkey-gate-contract.md) for the contract direction.
- Magic-link, email OTP, SMS OTP challenges.
- TOTP enrollment and verification.
- SSO redirect, callback handling, and identity linking.
- Recovery (`on_success: reset_credential`).

### State machine

- Pivot stack (push/pop on cross-flow transitions).
- Dynamic step injection from the policy engine (e.g. policy demands a second factor).
- Implicit policy evaluation at the terminal step — the design calls for it; today, completion is driven by definition transitions only.
- Engine-emitted outcomes beyond `user_not_found` (`user_link_required`, `user_locked`, …) — see [ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md).

### On-success handlers

- Only `create_user` exists today. `reset_credential`, `enroll_factor`, `create_user_with_passkey`, `create_user_with_sso`, `link_sso` are referenced in design docs but unimplemented.
- The dispatch carve-out for credential establishment is `OnSuccess == create_user`; the writer-manifest generalization is open (ADR 017).

### Resolution

- `ResolveFlowRequest.Hint` (`AppID`, `TeamID`, `UserSchemaID`) is plumbed through the service but not honored by `resolveByAudience`. Today the first match from `(status=active, purpose)` wins, with no specificity ranking.
- `pickLatestFlowVersion` does a lexicographic compare — only correct while `schema_version` stays zero-padded `MAJOR.MINOR.PATCH`.

### Storage

- Definition `validate` and `simulate` endpoints are described in design docs but not yet exposed.
- Definition lifecycle (`activate`, `archive`, `deprecate`) is not exposed via the API — only direct repository writes today.

### Other

- Branding / template selection beyond `defaultBranding()` — the handler always returns the built-in default.
- `step.challenge` payload (per [ADR 013](../../adrs/013-passkey-gate-contract.md)) and `challenge_response` on submit.
- Session integration: the engine mints `sess_*` ids but does not yet read or write durable session rows.
- `auth_request_id` and `redirect_uri` are stored on `FlowState` but the OIDC handshake that consumes them is out of scope.

## What you can build today

Without writing any new code, the engine supports:

- **Pure password signin** with identifier + password on separate steps, routing via `user_not_found`.
- **Pure password signup** when the identifier and the password live on the same `create_user` step. Multi-step signup needs the dispatch generalization in [ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md).
- **Combined login + register** when the entry step declares `user_not_found` and routes to the registration branch.
- **Terminal `show` flows** for self-service registration without an OIDC auth request.
- **Terminal `redirect` flows** when `redirect_uri` is set at `Start` (the OIDC handshake itself is not yet wired).
