# ADR 020: Credentials Out of the User Schema

> **Status:** Proposed
> **Date:** 2026-06-01
> **Context:** User schema, flow engine credential references

## Context

The user schema (`api/openapi/endpoints/schemas/user-schema.yaml`,
`user-property.json`) plays two roles today:

1. The structural contract for a tenant's user attributes — the shape
   the EAV store validates writes against (ADR 008, ADR 009).
2. The dictionary the flow engine reads to emit `FlowField` capabilities.
   A property with `x-password: true` plus schema-level
   `x-auth-methods.password.enabled = true` becomes a password challenge.

We also want the user schema to describe the user object returned by the
read API. That shape cannot contain credentials — passwords, passkey
public keys, OTP seeds, SSO links — and password complexity rules don't
fit JSON-Schema vocabulary anyway. Storage already separates credentials
(`user_passwords`, `user_passkeys`, `user_totp`, `user_recovery_codes`);
the schema is the layer still pretending they are attributes.

## Decision

The user schema describes **user attributes only**. Credentials are not
properties.

- `user-property.json` drops `x-password`.
- `x-auth-methods` at the schema root is unchanged: it declares which
  methods this user type supports and remains the policy engine's input.
- Credential APIs and credential policy are **out of scope** for this ADR.

Flow steps reference credentials through reserved syntax that resolves
back to `x-auth-methods.<kind>`:

| Credential shape | Examples | Where it lives in a step |
|---|---|---|
| Field-shaped (typed input) | `password`, OTP verify | `fields[]` entry: reserved token `x-auth-methods-<kind>` |
| Action-shaped (button + ceremony) | `passkey`, `magic_link`, OTP issue, SSO | `actions.<name>.auth_method: "<kind>"` |

The validator cross-checks every reference against the user schema's
`x-auth-methods` and rejects references to disabled methods.

> **Follow-up — token naming.** `x-auth-methods-password` mirrors the
> schema-root key but reuses the JSON-Schema `x-` annotation convention
> outside its native context. Alternatives such as `auth-method:password`,
> `credential:password`, or bare reserved names are worth revisiting
> before implementation; the decision above does not depend on which
> spelling is picked.

## Before / After

### User schema

**Before** — credentials embedded as attributes:

```yaml
$id: https://acme.com/schemas/users/v1
$schema: https://json-schema.org/draft/2020-12/schema
kind: user-schema
metaSchema: https://nextgen.com/api/schemas/user-schema-v1.0.json
x-auth-methods:
  password: { enabled: true }
  passkey:  { enabled: true }
required: [email, given_name, family_name, password]
properties:
  email:       { type: string, format: email, x-unique: project, x-identifier: true }
  given_name:  { type: string }
  family_name: { type: string }
  password:    { type: string, minLength: 8, x-password: true }   # ← credential as attribute
```

**After** — attributes only; credentials referenced through
`x-auth-methods`:

```yaml
$id: https://acme.com/schemas/users/v2
$schema: https://json-schema.org/draft/2020-12/schema
kind: user-schema
metaSchema: https://nextgen.com/api/schemas/user-schema-v1.1.json
x-auth-methods:
  password: { enabled: true }
  passkey:  { enabled: true }
required: [email, given_name, family_name]
properties:
  email:       { type: string, format: email, x-unique: project, x-identifier: true }
  given_name:  { type: string }
  family_name: { type: string }
```

The v2 document is now a valid shape for `GET /users/{id}` responses.

### Flow definition

**Before** — password is a schema property; passkey is a magic action name:

```yaml
name: signin
fields: [email, password]
actions:
  submit:  { primary: true }
  passkey: {}
transitions:
  submit:  { target: done }
  passkey: { target: done }
```

**After** — credentials referenced explicitly:

```yaml
name: signin
fields: [email, x-auth-methods-password]
actions:
  submit:         { primary: true }
  signin_passkey: { auth_method: passkey }
transitions:
  submit:         { target: done }
  signin_passkey: { target: done }
```

`x-auth-methods-password` in `fields[]` and `auth_method: "passkey"` on
the action both resolve back to the schema's `x-auth-methods.<kind>`.
The action key (`signin_passkey`) stays a free identifier the author
picks; the wiring is on the descriptor.

## Out of scope

- The credential-management APIs (set password, register passkey, …).
- The credential policy surface (password complexity, passkey
  attestation, OTP issuer). Today these are code defaults; a follow-up
  ADR picks a configuration home.

## Open questions

- **`sso_providers[]` overlap.** SSO buttons today live on
  `step.sso_providers[]`, not under `actions{}`. With the action-side
  `auth_method` mechanism, an SSO button could equivalently be an action
  with `auth_method: "sso"` and a provider id. Folding them removes the
  second mechanism but breaks the existing `sso_providers[]` contract.
  Worth tracking; not blocking.
- **Credential policy home.** Removing `x-password` removes the only
  customer-facing place to express password rules. Likely belongs on
  project/team config; subject of a follow-up ADR.

## Consequences

### Positive

- User schema cleanly describes the user object including the
  `GET /users/{id}` response shape. Credentials cannot leak through it.
- Schema, flow engine, and storage agree that credentials are not
  attributes.
- Adding a new credential kind extends `x-auth-methods` and the
  credential subsystem without reshuffling user-schema properties.

### Negative / Risks

- Two namespaces in `step.fields[]` (schema properties + credential
  tokens). Validator must police "looks like a property but isn't."
- Two references back to `x-auth-methods.<kind>` (field tokens and
  action `auth_method`). Validator owns keeping them consistent.
- `FlowField.Validation` no longer carries password rules until the
  credential-policy ADR lands.

---

## Appendix: Internal impact on the flow engine

This appendix records the changes inside the engine that follow from
the decision above. It is informational; the contract is the
before/after sections.

### `FlowFieldResolver` / `SchemaFieldResolver`

`Resolve` classifies each entry in `fieldNames`:

1. **Reserved credential token** (`x-auth-methods-<kind>`) → consult
   `x-auth-methods.<kind>` at the schema root. If `enabled: false` or
   absent → integrity error. On success emit a `FlowField` with
   `Type` and `Challenge` derived from the kind, `Required = true`,
   `Validation = nil` (credential policy lives elsewhere),
   `TextKey = "<stepName>.field.<token-or-alias>"`.
2. **Anything else** → schema-property lookup, as today.

`Validate` is a no-op for credential tokens; the credential subsystem
(hasher, WebAuthn verifier, OTP comparator) decides acceptance.

### `FlowField` mapping

| Source | `Type` | `Challenge` | `Required` | `Validation` |
|---|---|---|---|---|
| Schema property | from `type`+`format` | from `x-unique` etc. | from schema `required[]` | from schema keywords |
| Credential token (`x-auth-methods-password`) | `password` | `password` | always true | nil |

Ceremony-shaped credentials never produce a `FlowField`.

### Action linkage

`FlowStepAction` and `FlowAction` gain an `AuthMethod string` field
(empty for plain actions like `submit`, `register`, `recover`). When
set, the engine routes the corresponding submit to the credential
subsystem (issue a WebAuthn challenge, send a magic link, …) instead of
treating the submit as a plain transition. The action's `text_key`
remains independent of the linked method.

OTP spans both shapes: an issue action with `auth_method: "otp"` on
one step, and a field token `x-auth-methods-otp` on the verify step.
Two references back to the same `x-auth-methods.otp` across two steps
is intentional, not a validation failure.

### `on_success` writer input

`FlowCreateUserHandler` today reads the password value out of
`FlowProgress.CollectedData` under the schema property name. With
credentials no longer properties, that value is gone. The writer's
input contract changes:

- Attributes: keep coming from `CollectedData`.
- Credential proofs: come from a new bucket on `FlowProgress`
  (working name `CollectedCredentials`), keyed by credential kind.

Same lifecycle as `CollectedData` (discarded with the parent flow on
pivot pop). This is the natural input for the writer-manifest model in
ADR 017.

### Composition with ADR 017

- ADR 020 (this one): *how* a step references a credential.
- ADR 017: *whether* the referenced credential is verified or
  established.

ADR 017's per-step `identifier`/`credential` properties continue to
apply on top of the references introduced here.

### Flow definition validator

New rules in `flow_definition_validator.go`:

- Schema-property entries in `fields[]` must exist in the schema's
  `properties`.
- Credential tokens in `fields[]` and `auth_method` on actions must
  match an `enabled: true` entry under `x-auth-methods`.
- A credential token must not appear twice in one step's `fields[]`,
  and a given auth method should not be triggered by two actions on
  the same step.

### Meta-schemas

- `api/openapi/endpoints/schemas/flow-definition.json` — `step.fields`
  shape unchanged (array of string, uniqueItems); prose updates to
  describe the reserved token namespace. `Action` gains an optional
  `auth_method` property (static enum: `password`, `passkey`,
  `magic_link`, `sso`, `otp`). Cross-check against the *user* schema's
  enabled methods stays in the Go validator.
- `api/openapi/components/flows/step-action.yaml` — mirror the new
  `auth_method` field.
