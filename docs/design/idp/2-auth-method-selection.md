# Auth-Method Selection

> **Status:** Planning notes  
> **Area:** 2 of 4 (see [`README.md`](README.md))

This document defines how a user schema declares which external identity
providers (like Google or GitHub) its users are permitted to sign in with, and
how that configuration is wired into the login flow.

## The Three-Way Linkage

Enabling a social provider for a user schema isn't a single toggle.
It requires three distinct artifacts to align perfectly:

| Artifact | Carries | Current State |
| :--- | :--- | :--- |
| **User schema** | `x-auth-methods: {password, passkey, magic_link, sso, otp}` | The `sso` slot exists. Currently, every entry is strictly `{enabled}` only, with `additionalProperties: false`. |
| **IdP connection** | The external provider configuration itself. | Outlined in area 1 (no server contract exists yet). |
| **Flow step** | `sso_providers: [{id, name, template}]` | Accepted by the meta-schema and validator; the engine rejects any SSO submission (`ErrFlowUnsupported`, `internal/domain/flow_state_machine.go`) and renders no providers. *Constraint:* Any step carrying these **must** define a `transitions.callback` (enforced by the validator). |

Each authentication method surfaces differently within a flow, meaning there is
no uniform rendering mechanism across the board:

```text
password → a field:      fields: ["x-auth-methods#password"]      // "only password is field-shaped today"
passkey  → actions:      actions: ["passkey", "passkey_register"]
sso      → its own slot: sso_providers: [...] + transitions.callback
```

## Principle: Capability vs. Usage

A schema's permission to use a method is kept separate from a flow's use of it:

> **Schema declares capability · flow declares usage · validator enforces
> consistency.**

For example, a password's presence in a flow is **not** automatically derived
from the schema.
The schema grants the capability (`password.enabled: true`), but the flow must
independently declare its usage (`fields: ["x-auth-methods#password"]`).
The `validateFlowDefinition` function then cross-checks the two using
`authMethodEnabled` (which mirrors the Go server's
`xAuthMethodsReader.IsEnabled`).

SSO strictly follows this same pattern.
Rather than injecting `sso_providers` at apply time, the CLI writes the flow
edit into the file, so the committed file shows the changes that will be
deployed.
The CLI owns the regions it scaffolded, among them the `sso_providers` arrays
and the SSO steps.
Adding or removing a provider changes those fields, and the CLI makes that edit
only where their current value still equals what the scaffold produces.
A hand-edited field is never overwritten; the journey reports it instead
([area 4](4-cli-provider-setup.md#post-claim-re-entry)).

## Decision: Providers are Referenced in the User Schema

```jsonc
// Customers schema
"x-auth-methods": {
  "passkey": { "enabled": true },
  "sso":     { "enabled": true, "providers": ["google"] }
}

// Employees schema
"x-auth-methods": {
  "passkey":  { "enabled": true },
  "password": { "enabled": true },
  "sso":      { "enabled": true, "providers": ["github"] }
}
```

SSO providers are listed explicitly in the user schema, rather than behind a
generic `sso.enabled` toggle or through the connection referencing the schema.

**Why a generic `sso.enabled` toggle was rejected:**
- **Peers of password and passkey:** The epic frames Google and GitHub as
  answers to "how should these users sign in?", a property of the schema.
- **UI Visibility:** Both the post-claim journey and the Console need to display
  exactly which authentication methods a schema supports.
  A generic `sso.enabled` flag would only allow them to render a vague "SSO:
  on".

**Why having the connection list its schemas was rejected:**
- **Avoiding Cascading Revisions:** Schemas do not have stable names; they are
  identified by revision IDs.
  If a connection referenced schemas, every schema edit would force a new
  connection revision, requiring complex `FlowRepin`-style rewrite mechanisms.
  Instead, connections use stable `slug`s specifically so they can be safely
  referenced by revision-named resources (like schemas) without triggering a
  cascade.
- **Lookup Efficiency:** "Which providers does this schema offer?" is asked on
  every UI and post-claim render, and the schema is a document those views
  already hold.
  The reverse question is asked only at plan time, where scanning the working
  tree is fine.

### Provider States

A provider is in one of four states for a user type, set by whether that user
type's schema lists it in `sso.providers` and whether a flow on that schema
offers it in a step.

| State | Customer sees | Validator |
| :--- | :--- | :--- |
| Connection file exists, listed by no schema | Nothing. The credentials are kept; no user type can use the provider. | Inert Connection, warning ([area 1](1-resource-model.md#validator-rules)) |
| Listed in `sso.providers`, offered in no flow | The Console and the post-claim menu show the provider as a method of this user type; no login page offers it. Allowed, not wired yet, the same state `password.enabled: true` without a password field is in today. | Dead capability, warning |
| Listed and offered in a flow step | The button, on that page. | the cross-checks below |
| Removed from `sso.providers`, or `sso.enabled: false` | This user type no longer uses the provider. Every flow that still offers it is an error until its step drops it. | Flow enables SSO, Provider ID validity, errors |

A disabled slot is always written `{"enabled": false}` with no `providers`
array.
Disabling while keeping the list is rejected by the schema
([below](#providers-and-enabled-must-agree)), so there is no state that reads as
paused but behaves as removed.
Whether `enabled: false` should instead mean paused, flows untouched and the
button hidden at render, is a question about every authentication method, not
only `sso`; it is recorded in the [README](README.md#product-decisions).

Removing a provider is a two-file edit: the slug is removed from
`sso.providers` in the user schema and from `sso_providers` in the flow
definition steps.
Editing only the schema fails because a flow pins a schema revision.
The schema edit re-pins every flow on it, and a re-pinned flow that still
offers the provider fails validation before apply (extending
`apps/cli/src/lib/sync/flow-validation.ts`).
Editing only the flow leaves the schema advertising a provider that no page
offers, which is a dead capability.

Removing a method existing users depend on is not specific to SSO.
A user whose only credential is the removed method is locked out permanently:
the flow offers only the remaining options, and adding a new credential
requires authenticating first, a proof the user can no longer provide.
The same deadlock occurs when a schema moves from passwords to passkeys.
Email recovery isn't available yet.
Recorded as a product decision in the [README](README.md#product-decisions).

### Schema Location for `providers`

Because `auth-method.json` is referenced (`$ref`) by all five authentication
slots, simply adding `providers` to it would allow nonsensical configurations
like `password.providers`.
To solve this, a new `sso-auth-method.json` schema extends the base
definition.
The main `auth-methods.json` schema then specifically points its `sso` slot to
this new file.
Same split as `user-property.json` / `property-name.json`.

### `providers` and `enabled` Must Agree

The `providers` array is required and non-empty when SSO is enabled.

- **Avoiding the "Absent-Means-All" Footgun:** If an omitted array defaulted to
  "allow all," adding a new GitHub connection for one specific schema would
  silently activate it across *every* schema where `sso.enabled: true`.
  This directly violates the rule that simply creating a provider connection
  does not make it universally available.
- **Disabled carries no `providers` array:** A generator that emits all five
  slots as `{"enabled": false}` stays valid.
  A disabled slot that still carries a list is rejected, so `enabled` and the
  list never disagree about whether the user type uses social sign-in
  ([Provider States](#provider-states)).

The draft: [`schemas/sso-auth-method.json`](schemas/sso-auth-method.json).

The `enabled` field remains strictly required, matching the behavior of the
other four authentication methods.

- **Migration friendly:** A bare `{"enabled": false}` object is perfectly valid.
  This allows an existing schema to introduce the `sso` slot before it actually
  defines any providers.

## Validation Rules

The validation model strictly follows the established password precedent: the
flow declares usage, and the validator checks that the schema explicitly enables
it (emitting an error like
*`step "…": "password" is not an enabled authentication method`* if it fails).

| Rule / Condition | Status & Impact |
| :--- | :--- |
| **Flow enables SSO** | **Mirrors existing logic:** If a step has `sso_providers`, the schema's `sso.enabled` must be `true`. |
| **Provider ID validity** | **New:** Every `sso_providers[].id` must exist in the pinned schema's `sso.providers` list. |
| **Cross-resource resolution** | **New:** Every name in `sso.providers` must resolve to a valid connection file under `.zitadel/idps/`. |
| **Callback transition** | **Already enforced:** A step utilizing `sso_providers` must define a `transitions.callback`. |
| **Full outcome routing** | **New:** A step with `sso_providers` must properly route `identity_unknown` and `user_already_exists`. The engine fires three possible outcomes, and routing only the callback dead-ends the other two. |
| **Empty `claim_mapping` intersection** | **New (Warning):** If an offered provider's `claim_mapping` shares zero properties with the pinned schema, the collection fields are not prefilled, and every sign-up stops at the collection step for manual input. |
| **Empty `verified_claims` intersection** | **New (Warning):** If a provider's `verified_claims` keys share no properties with the pinned schema, every property arrives unverified. Where a required property carries a non-empty `x-unique` scope, the auto-creation gate never passes and sign-up stops at the collection step. |
| **Wildcard `issuer_pattern` conflict** | **Warning:** An environment declaring a wildcard `issuer_pattern` cannot produce the exact redirect URIs providers require (environments are design-only until [#534](https://github.com/zitadel/nextgen/issues/534)). Plan warns, never errors: a release is one artifact promoted through every environment, so a pattern environment must not block it. The engine leaves the provider buttons out at render ([area 3](3-social-login-flow.md#constraints--edge-cases)). |
| **Dead capability** | **Warning:** A schema lists a provider that no flow offers. The Console shows it as a method of this user type, but no login page carries the button. |
| **Collection-step conflict routing** | **New:** A step whose `on_success` is `create_user_with_sso` must route `user_already_exists`. Area 3 fires that outcome at collection-step submission as well as at callback resolution, and requires the conflict transition attached to both steps. |

---

### Deliberate Exclusions from Validation

The validator deliberately **does not** cross-check `sso_providers[].name` or
`sso_providers[].template` against the connection file.

`name` is display copy, often localized client-side, and `template` a rendering
hint; a flow may override both.
Only `id` (the slug) must resolve.

## Open Points

- **Generators around a method set:** `sign-in-preset.ts` is a single-select
  over two presets that drives both the schema and the flow generator, with the
  use case applied as a post-transform.
  The epic needs a multi-select over four methods (passkey pre-selected, Google
  and GitHub flagged as needing setup).
  Recomposing the generators around a method set instead of a preset is the main
  CLI work in this area and is not designed yet.
- **Breaking schema migrations:** Switching to `sso-auth-method.json` is a
  breaking change for one specific schema state: any payload containing
  `sso: {"enabled": true}` without a `providers` array.
  While this was valid under the legacy `auth-method.json`, it fails the new
  conditional validation.
  Existing stored schema revisions are immutable and unaffected, but attempting
  to re-publish or edit an affected schema body will trigger a validation error
  until a non-empty `providers` list is added or the `sso` block is removed.
  Schemas omitting the `sso` entry entirely remain unaffected.

## Dependencies

| Requirement | Owed By |
| :--- | :--- |
| **Pair-level `claim_mapping` intersection:** warn when an offered provider's `claim_mapping` shares zero properties with the pinned schema (the [Validation Rules](#validation-rules) row). | `validate.ts` and the Go server mirror, at flow create and update |
| **Pair-level `verified_claims` intersection:** warn when a provider's `verified_claims` keys share no properties with the pinned schema. | `validate.ts` and the Go server mirror, at flow create and update |
| **Register-step topology:** whether registration shares the entry steps' `sso_providers` or carries its own step. Both shapes pass the validator and run, so the choice is scaffolding, not validation. | [`4-cli-provider-setup.md`](4-cli-provider-setup.md#flow-architecture-decisions) (settled: `sso_providers` on both shared entry steps and the conflict step) |
| **Runtime example alignment:** `components/flows/sso-provider.yaml` shows an instance-suffixed `id: google-1`; `SSOProvider.id` is the connection slug, and the runtime example must say so before the engine reads it. | Flow API docs |

The two pairing rows live here because the flow definition is the only document
that references both sides: its `user_schema` pins the schema revision and its
`sso_providers[].id` names the connection.
Connection-side checks flag a key unknown to *every* referencing schema; partial
per-pair overlap is legitimate, since a connection may map a superset.
Both rows are provisional pending schema-keyed validation
([area 1](1-resource-model.md#open-points)).
Cross-resource rules are implemented twice, in `validate.ts` and the Go server;
the Go mirror of the new error-grade rules is tracked in area 1's
[Dependencies](1-resource-model.md#dependencies).

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1)
- [ADR 020](../../adrs/020-credentials-out-of-user-schema.md) (`x-auth-methods`
  as policy input)
- `packages/config/meta-schemas/auth-methods.json`, `auth-method.json`
- `packages/config/src/validate.ts` (`validateFlowDefinition`,
  `RESERVED_OUTCOMES`, `PURPOSE_FLIP_TARGETS`; internal `authMethodEnabled`,
  `resolveFieldChallenge`, `AUTH_METHOD_PREFIX`)
- `packages/config/defaults/default-login.json` (step shapes)
- `api/openapi/endpoints/schemas/flow-definition.json` (`SSOProvider`)
