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
- Cookie missing / invalid / expired → 401; cookie-id mismatch → 404; flow-already-completed (GET only) → 410.

### Resolution

- Direct lookup by `name` (with optional `schema_version`). Multiple matches resolve via `pickLatestFlowVersion` — a lexicographic compare over `schema_version` strings (see [Missing → Resolution](#resolution-1)).
- Audience-based resolution by `purpose` plus active `status`:
  `user_schema_id` is a hard filter, then candidates score app match > team
  match > project-wide > a definition scoped elsewhere. Equal scores prefer
  newer `created_at`, then the higher ID.
- Fails with `ErrFlowDefinitionPurposeMismatch` when a name-resolved definition doesn't serve the requested purpose.

### Definitions

- `FlowDefinitionStatements` over Postgres, Spanner, and SQLite (the storage layer).
- API-exposed status values: `draft`, `active`.
- Per-definition `user_schema` URL, captured into `FlowState` at `Start`.

### Steps & state machine

- Schema-driven `fields`: type, validation, `required`, uniqueness scope, challenge mapping from the `x-unique` annotation on user properties, or — for credential fields — the reserved `x-auth-methods#<method>` field name resolved against the schema's `x-auth-methods`.
- `actions` — user-selectable, surfaced on the capability payload. `passkey` and `passkey_register` are recognized action names that drive the passkey ceremony.
- `on_success: create_user` — hashes the password (argon2id), writes the user and credential rows, then calls `auth-attempt.RegisterCreatedUser` so the new user counts as verified for the terminal handoff.
- `complete: redirect` and `complete: show` — terminal step classifiers.
- Implicit identifier resolution from any identifier-shaped field; routes via `user_not_found` (login flows) or `user_already_exists` (register flows) when wired, errors otherwise. The engine flips `CurrentPurpose` on the matching outcome to switch sub-flows.
- Implicit password verification when a password-shaped field is present and `on_success` is not `create_user`.
- Step error path: validation failures and password rejection re-render the current step with `Error` set; the state machine does **not** advance.
- Terminal-step handoff: when a user has been resolved, calls `auth-attempt.Handoff` and returns the token + expiry on `FlowStepResult`.
- Field pre-fill: `CollectedData` is propagated into resolved fields before every step render so re-renders carry the user's previous input.

### Passkey ceremony (two-phase)

- `passkey` (login) and `passkey_register` (signup) actions trigger an **issue → client signs → verify** ceremony that short-circuits the field-shaped dispatch.
- **Phase 1 (issue)** — the step emits a `challenge` on the response (`method`, `challenge_id`, `options`). For login, identifier dispatch runs first so `PreparePasskeyChallenge` can populate `allowCredentials` with the resolved user's credential IDs. For registration, `GenerateUserID()` mints a provisional `_user_id` (marked via the reserved `_passkey_provisional` collected key) so the WebAuthn `user.id` can be stable across phases.
- **Phase 2 (verify)** — the submit carries `challenge_response.proof`. On registration verify, `HandleProvisional` creates the user row inside the same DB transaction that persists the credential, then `RegisterCreatedUser` marks the user as verified on the auth attempt.
- RPID derivation: `WithRequestHostMiddleware` injects effective proto+host into the request context so handlers can derive the WebAuthn RPID when the browser omits `Origin` on same-origin fetches.

### Step response shape

- `name`, `texts` (`title_key`, `description_key`), optional `error`, optional `complete`.
- `fields` **ordered array** of entries carrying `name`, `type`, `text_key`, `required`, optional `value`, optional `validation` ([ADR 021](../../adrs/021-ordered-arrays-for-step-fields-actions-gates.md)).
- `actions` **ordered array** of entries carrying `name`, `kind`, `text_key`, and a `primary` flag. The LiquidJS template iterates the arrays in order and builds name-keyed indexes locally for lookup.
- `challenge` populated on the issue leg of a two-phase ceremony (passkey today): `method`, `challenge_id`, ceremony-specific `options`.
- `gates` and `sso_providers` are part of the contract but not yet emitted with content (see below).

## Stubbed (returns `ErrUnsupported`)

These contracts exist on the wire and in the state machine but reject at runtime:

- **Cross-flow transitions.** `transitions.target` with `action: "pivot"` or `action: "switch"` is rejected. `PivotStack` is defined on `FlowState` but never pushed.
- **SSO submissions.** Submitting an action with an `sso_provider_id` is rejected.
- **Gate proofs.** Submitting a `gate_proofs` map is rejected.

`ErrFlowUnsupported` maps to HTTP 400 with `code: "flow.unsupported"`.

## Missing

Not implemented at any layer:

### Auth methods

- Magic-link, email OTP, SMS OTP challenges.
- TOTP enrollment and verification.
- SSO redirect, callback handling, and identity linking.
- Recovery (`on_success: reset_credential`).

### State machine

- Pivot stack (push/pop on cross-flow transitions).
- Dynamic step injection from the policy engine (e.g. policy demands a second factor).
- Implicit policy evaluation at the terminal step — the design calls for it; today, completion is driven by definition transitions only.
- Engine-emitted outcomes beyond `user_not_found` and `user_already_exists` (`user_link_required`, `user_locked`, …) — see [ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md).

### On-success handlers

- `create_user` exists today, with a `HandleProvisional` sibling used by the passkey-register verify leg to finalize the provisional user inside the credential-save transaction.
- `reset_credential`, `enroll_factor`, `create_user_with_sso`, `link_sso` are referenced in design docs but unimplemented.
- The dispatch carve-out for credential establishment is `OnSuccess == create_user`; the writer-manifest generalization is open (ADR 017).

### Resolution

- `pickLatestFlowVersion` does a lexicographic compare — only correct while `schema_version` stays zero-padded `MAJOR.MINOR.PATCH`.

### Storage

- Definition `validate` and `simulate` endpoints are described in design docs but not yet exposed.
- Definition lifecycle (`activate`, `archive`, `deprecate`) is not exposed via the API — only direct repository writes today.

### Other

- Branding / template selection beyond `defaultBranding()` — the handler always returns the built-in default.
- Session integration: the engine mints `sess_*` ids but does not yet read or write durable session rows.
- `auth_request_id` and `redirect_uri` are stored on `FlowState` but the OIDC handshake that consumes them is out of scope.
- `redirect_uri` allowlist validation at `Start` — accepted as-supplied today.

## What you can build today

Without writing any new code, the engine supports:

- **Pure password signin** with identifier + password on separate steps, routing via `user_not_found`.
- **Pure password signup** when the identifier and the password live on the same `create_user` step. Multi-step signup needs the dispatch generalization in [ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md).
- **Combined login + register** when the entry step declares `user_not_found` and routes to the registration branch.
- **Passkey login** — discoverable credentials or allow-list per resolved user; the issue leg runs identifier dispatch first so `allowCredentials` is populated.
- **Passkey signup** — single step with the `passkey_register` action; the provisional user is finalized by `HandleProvisional` on the verify leg.
- **Terminal `show` flows** for self-service registration without an OIDC auth request.
- **Terminal `redirect` flows** when `redirect_uri` is set at `Start` (the OIDC handshake itself is not yet wired).
