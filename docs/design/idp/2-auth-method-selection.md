# Auth-Method Selection

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 2 of 4 (see [`README.md`](README.md))

This document defines how a user schema declares which external identity providers (like Google or GitHub) its users are permitted to sign in with, and how that configuration is wired into the login flow.

## The Three-Way Linkage

Enabling a social provider for a user schema isn't a single toggle. It requires three distinct artifacts to align perfectly:

| Artifact | Carries | Current State |
| :--- | :--- | :--- |
| **User schema** | `x-auth-methods: {password, passkey, magic_link, sso, otp}` | The `sso` slot exists. Currently, every entry is strictly `{enabled}` only, with `additionalProperties: false`. |
| **IdP connection** | The external provider configuration itself. | Outlined in area 1 (no server contract exists yet). |
| **Flow step** | `sso_providers: [{id, name, template}]` | Supported. *Constraint:* Any step carrying these **must** define a `transitions.callback` (enforced by the validator). |

Each authentication method surfaces differently within a flow, meaning there is no uniform rendering mechanism across the board:

```text
password → a field:      fields: ["x-auth-methods#password"]      // "only password is field-shaped today"
passkey  → actions:      actions: ["passkey", "passkey_register"]
sso      → its own slot: sso_providers: [...] + transitions.callback
```

## Principle: Capability vs. Usage

We enforce a strict separation between what is permitted and what is actually used:

> **Schema declares capability · flow declares usage · validator enforces consistency.**

For example, a password's presence in a flow is **not** automatically derived from the schema. The schema grants the capability (`password.enabled: true`), but the flow must independently declare its usage (`fields: ["x-auth-methods#password"]`). The `validateFlowDefinition` function then cross-checks the two using `authMethodEnabled` (which mirrors the Go server's `xAuthMethodsReader.IsEnabled`).

SSO strictly follows this same pattern. Rather than dynamically injecting `sso_providers` at apply time, the CLI explicitly **scaffolds** the flow edit. This guarantees that the configuration file remains transparent and safely hand-editable.

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

We explicitly list SSO providers in the user schema rather than relying on a generic `sso.enabled` toggle, and rather than having the connection reference the schema.

**Why we rejected a generic `sso.enabled` toggle:**
- **Philosophical alignment:** The epic frames specific providers (like Google or GitHub) as direct peers to passwords and passkeys. They answer the fundamental question, *"How should these users sign in?"*, making them an intrinsic property of the schema rather than a mere flow detail.
- **UI Visibility:** Both the post-claim journey and the Console need to display exactly which authentication methods a schema supports. A generic `sso.enabled` flag would only allow them to render a vague "SSO: on".

**Why we rejected having the connection list its schemas:**
- **Avoiding Cascading Revisions:** Schemas do not have stable names; they are identified by revision IDs. If a connection referenced schemas, every schema edit would force a new connection revision, requiring complex `FlowRepin`-style rewrite mechanisms. Instead, connections use stable `slug`s specifically so they can be safely referenced by revision-named resources (like schemas) without triggering a cascade.
- **Lookup Efficiency:** The system frequently asks, *"Which providers does this schema offer?"* (for UI and post-claim rendering). By storing the list in the schema, this becomes a fast, direct read from a document those views already hold. If the connection held the list instead, every UI render would have to scan every connection in the Project and match brittle revision IDs. The reverse question, *"Which schemas reference this connection?"*, is only asked infrequently during plan validation, making it perfectly acceptable for the validator to compute it by scanning the working tree.

### What Each State Means

Three files can name a provider, and the same provider can be in any of four states for a user type. Each has one customer-facing meaning:

| State | Customer sees | Validator |
| :--- | :--- | :--- |
| Connection file exists, listed by no schema | Nothing. The credentials are kept; no user type can use the provider. | Inert Connection, warning ([area 1](1-resource-model.md#validator-rules)) |
| Listed in `sso.providers`, offered in no flow | The Console and the post-claim menu show the provider as a method of this user type; no login page offers it. Allowed, not wired yet, the same state `password.enabled: true` without a password field is in today. | Dead capability, warning |
| Listed and offered in a flow step | The button, on that page. | the cross-checks below |
| Removed from `sso.providers`, or `sso.enabled: false` | This user type no longer uses the provider. Every flow that still offers it is an error until its step drops it. | Flow enables SSO, Provider ID validity, errors |

A disabled slot is always written `{"enabled": false}` with no `providers` array. Disabling while keeping the list is rejected by the schema ([below](#providers-and-enabled-must-agree)), so there is no state that reads as paused but behaves as removed. Whether `enabled: false` should instead mean paused, flows untouched and the button hidden at render, is a question about every authentication method, not only `sso`; it is recorded in the [README](README.md#product-decisions).

Removing a provider by hand is a two-file edit, and the plan says so: a flow pins a schema revision, so the schema edit re-pins every flow on it, and a flow that still offers the provider fails the plan before anything is applied (`apps/cli/src/lib/sync/flow-validation.ts`). Production keeps the old revisions. The Sign-in methods journey makes both edits in one step (area 4, [Post-Claim Re-entry](4-cli-provider-setup.md#post-claim-re-entry)): it removes the slug from `sso.providers` and from every step's `sso_providers`; an emptied list becomes `{"enabled": false}`; an emptied step drops its SSO-only transitions, the now-unreachable `register-sso` and `sso-conflict` steps, and the `user_already_exists` retarget. At least one method stays selected. Deselecting never deletes the connection file or the credentials; an unused connection is area 1's inert-connection warning, and whether removing the last provider should offer to delete the file is open.

### Schema Location for `providers`

Because `auth-method.json` is referenced (`$ref`) by all five authentication slots, simply adding `providers` to it would allow nonsensical configurations like `password.providers`. To solve this, we introduce a new `sso-auth-method.json` schema that extends the base definition. The main `auth-methods.json` schema then specifically points its `sso` slot to this new file. This cleanly aligns with our existing structural patterns (such as the split between `user-property.json` and `property-name.json`) and matches how `meta-schemas.ts` enumerates files for publishing.

### `providers` and `enabled` Must Agree

The `providers` array is required and non-empty when SSO is enabled, and absent when it is not.

- **Avoiding the "Absent-Means-All" Footgun:** If an omitted array defaulted to "allow all," adding a new GitHub connection for one specific schema would silently activate it across *every* schema where `sso.enabled: true`. This directly violates the rule that simply creating a provider connection does not make it universally available.
- **Disabled carries no `providers` array:** A generator that emits all five slots as `{"enabled": false}` stays valid. A disabled slot that still carries a list is rejected, so `enabled` and the list never disagree about whether the user type uses social sign-in ([What Each State Means](#what-each-state-means)).

The draft: [`schemas/sso-auth-method.json`](schemas/sso-auth-method.json).

The `enabled` field remains strictly required, matching the behavior of the other four authentication methods.

- **Migration friendly:** A bare `{"enabled": false}` object is perfectly valid. This allows an existing schema to introduce the `sso` slot before it actually defines any providers.
- **No dormant list:** Turning SSO off drops the list. Git keeps the old one; the file does not carry a state that looks paused and behaves as removed.
- **Multi-file impact:** Disabling SSO is never a single-file edit. If you set `enabled: false` on the schema, but a flow still actively offers those providers, the validator will immediately flag it as an error.

These exact schema constraints (specifically that `{"enabled": false}` is valid for migrations, that `enabled: false` with a list is rejected, and that `enabled: true` paired with an empty or missing `providers` list is rejected) are verified in [`packages/config/src/idp-design-docs.test.ts`](../../../packages/config/src/idp-design-docs.test.ts).

## Validation Rules

The validation model strictly follows the established password precedent: the flow declares usage, and the validator checks that the schema explicitly enables it (emitting an error like *`step "…": "password" is not an enabled authentication method`* if it fails).

| Rule / Condition | Status & Impact |
| :--- | :--- |
| **Flow enables SSO** | **Mirrors existing logic:** If a step has `sso_providers`, the schema's `sso.enabled` must be `true`. |
| **Provider ID validity** | **New:** Every `sso_providers[].id` must exist in the pinned schema's `sso.providers` list. |
| **Cross-resource resolution** | **New:** Every name in `sso.providers` must resolve to a valid connection file under `.zitadel/idps/`. |
| **Callback transition** | **Already enforced:** A step utilizing `sso_providers` must define a `transitions.callback`. |
| **Full outcome routing** | **New:** A step with `sso_providers` must properly route `user_not_found` and `user_already_exists`. The engine fires three possible outcomes, and routing only the callback dead-ends the other two. |
| **Empty `claim_mapping` intersection** | **New (Warning):** If an offered provider's `claim_mapping` shares zero properties with the pinned schema, the pairing prefills nothing. Sign-up will degrade to fully manual data collection. |
| **Empty `verified_claims` intersection** | **New (Warning):** If a provider's `verified_claims` keys share no properties with the pinned schema, the verification state has nowhere to land. |
| **Wildcard `issuer_pattern` conflict** | **Warning:** An environment declaring a wildcard `issuer_pattern` cannot produce the exact redirect URIs that external providers require. *(Note: Environment declarations are currently design-only; the `issuer` / `issuer_pattern` shapes live in [`configuration-surface.md`, Environments](../platform/configuration-surface.md#environments), and persistence lands with [#534](https://github.com/zitadel/nextgen/issues/534)).* Plan warns, never errors: a release is one artifact promoted through every environment, and exact and pattern environments coexist in one project, so a pattern environment must not block the release. In a pattern environment the engine leaves the provider buttons out at render ([area 3](3-social-login-flow.md#constraints--edge-cases)). |
| **Dead capability** | **Warning:** A schema lists a provider that no flow ever offers. The Console would advertise a sign-in method that has no actual login path. |
| **Collection-step conflict routing** | **New:** A step whose `on_success` is `create_user_with_sso` must route `user_already_exists`. Area 3 fires that outcome at collection-step submission as well as at callback resolution, and requires the conflict transition attached to both steps. |

---

### Deliberate Exclusions from Validation

The validator deliberately **does not** cross-check `sso_providers[].name` or `sso_providers[].template` against the connection file.

While these fields duplicate properties found on the connection, this duplication is intentional:
*   `name` is the display name surfaced to the user and is often localized client-side.
*   `template` acts as a rendering hint.

A flow is fully permitted to legitimately override both of these values to suit the context of the user journey. Only the `id` (the slug) is strictly required to resolve.

## Open Points

- **Generators around a method set:** `sign-in-preset.ts` currently acts as a single-select over two presets (`password-first` and `passkey-first`), driving both schema and flow generation through `getDefaultHumanUserSchema` and `getDefaultLoginFlow`. These are keyed strictly by preset (`PRESET_TEMPLATES`), with the specific use case applied via post-transforms to avoid maintaining a combinatorial matrix. Auth methods can follow this exact pattern: a base template transformed dynamically based on the selected method set. The epic requires a multi-select interface covering four methods (with passkeys pre-selected and Google/GitHub flagged as "additional setup required"). Recomposing these generators around a method set rather than a preset enum represents the main CLI work in this area and remains to be fully designed.
- **The register step topology:** Social sign-up requires `sso_providers` on the `register` step, not just on the `identifier` step. Because the flow outcome model in [`3-social-login-flow.md`](3-social-login-flow.md) is purpose-independent, both single-step and multi-step topologies are functionally valid. The final choice was a CLI scaffolding decision, which is now settled in [`4-cli-provider-setup.md`](4-cli-provider-setup.md#flow-architecture-decisions) in favor of a shared entry step.
- **Breaking schema migrations:** Switching to `sso-auth-method.json` is a breaking change for one specific schema state: any payload containing `sso: {"enabled": true}` without a `providers` array. While this was valid under the legacy `auth-method.json`, it fails the new conditional validation. Existing stored schema revisions are immutable and unaffected, but attempting to re-publish or edit an affected schema body will trigger a validation error until a non-empty `providers` list is added or the `sso` block is removed. Schemas omitting the `sso` entry entirely remain unaffected.

## Exported Requirements

| Requirement | Owed By |
| :--- | :--- |
| **Pair-level `claim_mapping` intersection:** warn when an offered provider's `claim_mapping` shares zero properties with the pinned schema (the [Validation Rules](#validation-rules) row). | `validate.ts` and the Go server mirror, at flow create and update |
| **Pair-level `verified_claims` intersection:** warn when a provider's `verified_claims` keys share no properties with the pinned schema. | `validate.ts` and the Go server mirror, at flow create and update |
| **Register-step topology:** "both single-step and multi-step topologies are functionally valid. The final choice was a CLI scaffolding decision" ([Open Points](#open-points)). | [`4-cli-provider-setup.md`](4-cli-provider-setup.md#flow-architecture-decisions) (settled: shared entry step) |
| **Runtime example alignment:** `components/flows/sso-provider.yaml` shows an instance-suffixed `id: google-1`; `SSOProvider.id` is the connection slug, and the runtime example must say so before the engine reads it. | Flow API docs |

The two pairing rows live here because the flow definition is the only document that references both sides: its `user_schema` pins the schema revision and its `sso_providers[].id` names the connection. Connection-side checks flag a key unknown to *every* referencing schema; partial per-pair overlap is legitimate, since a connection may map a superset. Both rows are provisional pending schema-keyed validation ([area 1](1-resource-model.md#open-points)). Cross-resource rules are implemented twice, in `validate.ts` and the Go server; the Go analog of `xAuthMethodsReader` is tracked in area 1's [Exported requirements](1-resource-model.md#exported-requirements).

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1)
- [ADR 020](../../adrs/020-credentials-out-of-user-schema.md) (`x-auth-methods` as policy input)
- `packages/config/meta-schemas/auth-methods.json`, `auth-method.json`
- `packages/config/src/validate.ts` (`authMethodEnabled`, `resolveFieldChallenge`, `AUTH_METHOD_PREFIX`)
- `packages/config/defaults/default-login.json` (step shapes)
- `api/openapi/endpoints/schemas/flow-definition.json` (`SSOProvider`)
