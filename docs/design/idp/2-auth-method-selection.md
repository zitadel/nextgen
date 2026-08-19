# Auth-Method Selection

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 2 of 9 (see [`README.md`](README.md))

This document defines how a user schema declares which external identity providers (like Google or GitHub) its users are permitted to sign in with, and how that configuration is wired into the login flow.

## Imported Requirements

- [x] **Stable `slug` on the connection** ([`1-resource-model.md`](1-resource-model.md)). Answered: both the `sso.providers` array and `sso_providers[].id` reference connections strictly by their slugs.

The requirements exported by this area are tracked elsewhere: the Go mirror of the cross-resource SSO rules lives in area 1's [exported table](1-resource-model.md#exported-requirements), while the register-step and conflict-step scaffolding rules (owed to area 4) are detailed in [`3-social-login-flow.md`](3-social-login-flow.md).

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

### Schema Location for `providers`

Because `auth-method.json` is referenced (`$ref`) by all five authentication slots, simply adding `providers` to it would allow nonsensical configurations like `password.providers`. To solve this, we introduce a new `sso-auth-method.json` schema that extends the base definition. The main `auth-methods.json` schema then specifically points its `sso` slot to this new file. This cleanly aligns with our existing structural patterns (such as the split between `user-property.json` and `property-name.json`) and matches how `meta-schemas.ts` enumerates files for publishing.

### Conditional Requirement: `providers`

The `providers` array is strictly required and must be non-empty **only when SSO is enabled**.

- **Avoiding the "Absent-Means-All" Footgun:** If an omitted array defaulted to "allow all," adding a new GitHub connection for one specific schema would silently activate it across *every* schema where `sso.enabled: true`. This directly violates the rule that simply creating a provider connection does not make it universally available.
- **Tied to `enabled: true`:** The requirement is conditional. If a schema turns SSO off (but doesn't delete its list), or if a generator blindly emits all five slots as `{"enabled": false}`, the configuration remains perfectly valid without naming any providers.

<details open>
<summary><code>packages/config/meta-schemas/sso-auth-method.json</code></summary>

```jsonc
// packages/config/meta-schemas/sso-auth-method.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SSOAuthMethod",
  "type": "object",
  "required": [
    "enabled"
  ],
  "additionalProperties": false,
  "properties": {
    "enabled": {
      "type": "boolean",
      "description": "Whether the authentication method is enabled or not"
    },
    "providers": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9_-]*$",
        "maxLength": 64,
        "examples": [
          "google",
          "github",
          "corp_idp"
        ]
      },
      "description": "Slugs of the Project-level identity provider connections available to users of this schema. Each entry must match the `slug` of a connection under `.zitadel/idps/`; a connection existing does not by itself make it available here."
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "enabled": {
            "const": true
          }
        },
        "required": [
          "enabled"
        ]
      },
      "then": {
        "required": [
          "providers"
        ]
      }
    }
  ]
}
```

</details>

The `enabled` field remains strictly required, matching the behavior of the other four authentication methods.

- **Migration friendly:** A bare `{"enabled": false}` object is perfectly valid. This allows an existing schema to introduce the `sso` slot before it actually defines any providers.
- **State preservation:** A disabled SSO entry can safely retain its `providers` list, making it convenient to toggle SSO back on in the future.
- **Multi-file impact:** Disabling SSO is never a single-file edit. If you set `enabled: false` on the schema, but a flow still actively offers those providers, the validator will immediately flag it as an error.

These exact schema constraints (specifically that `{"enabled": false}` is valid for migrations, and that `enabled: true` paired with an empty or missing `providers` list is rejected) are verified in [`packages/config/src/idp-design-docs.test.ts`](../../../packages/config/src/idp-design-docs.test.ts).

### Referencing by Slug, Not ID

The `providers` list strictly holds slugs (names) rather than revision IDs (as detailed in [`1-resource-model.md`](1-resource-model.md)). This design choice prevents a cascading update cycle: if connections relied on revision IDs, setting `revisioned: true` on a connection would force new schema revisions and require flow re-pins every time the connection was edited.

**Authoring vs. Runtime Alignment:**
- **Authoring side:** This structure is already in place. The `SSOProvider.id` is correctly documented as the *"Provider instance identifier … routed to the corresponding configured IdP at the engine"*, using human-authored slugs like `["google", "corp_idp"]` instead of opaque platform IDs.
- **Runtime side:** The runtime documentation currently contradicts this. The example in `components/flows/sso-provider.yaml` shows an instance-suffixed ID (`id: google-1`). This runtime example must be updated to align with the authoring schema before the engine ships.

**Defining the Identity:**
The connection's `slug` field acts as its sole referenced identity.
- It is **not** the `id` (which `state.json` uses exclusively for the platform ID).
- It is **not** the filename (relying on file paths would cause references to silently break if a file is renamed).

To guarantee consistency, the validator strictly enforces that the `slug` remains unique across the entire `.zitadel/idps/` directory.

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
| **Wildcard `issuer_pattern` conflict** | **Warning:** An environment declaring a wildcard `issuer_pattern` cannot produce the exact redirect URIs that external providers require. *(Note: Environment declarations are currently design-only; the `issuer` / `issuer_pattern` shapes live in `../platform/configuration-surface.md:325-326`, and persistence lands with [#534](https://github.com/zitadel/nextgen/issues/534)).* |
| **Dead capability** | **Warning:** A schema lists a provider that no flow ever offers. The Console would advertise a sign-in method that has no actual login path. |
| **Collection-step conflict routing** | **New:** A step whose `on_success` is `create_user_with_sso` must route `user_already_exists`. Area 3 fires that outcome at collection-step submission as well as at callback resolution, and requires the conflict transition attached to both steps. |

---

### Deliberate Exclusions from Validation

The validator deliberately **does not** cross-check `sso_providers[].name` or `sso_providers[].template` against the connection file.

While these fields duplicate properties found on the connection, this duplication is intentional:
*   `name` is the display name surfaced to the user and is often localized client-side.
*   `template` acts as a rendering hint.

A flow is fully permitted to legitimately override both of these values to suit the context of the user journey. Only the `id` (the slug) is strictly required to resolve.

## End-to-End Workflow

```jsonc
// .zitadel/flows/customers-login.json - identifier step
{
  "name": "identifier",
  "fields": ["email"],
  "actions": [ /* submit, passkey, register */ ],
  "sso_providers": [{ "id": "google", "name": "Google", "template": "google" }],
  "transitions": { "callback": { "target": "done" } /* ... */ }
}
```
The execution chain resolves as follows:
1. The flow step names `google` in its sso_providers.
2. The pinned user schema's `sso.providers` array permits it.
3. The configuration loader locates `.zitadel/idps/google.json` matching `slug: "google"`.
4. The engine routes the authentication request to that connection.

Because every hop in this chain uses a slug rather than a revision ID, editing or updating an IdP connection creates a new revision without requiring any upstream changes to the flow or schema definitions.

## Open Points

- **Generators around a method set:** `sign-in-preset.ts` currently acts as a single-select over two presets (`password-first` and `passkey-first`), driving both schema and flow generation through `getDefaultHumanUserSchema` and `getDefaultLoginFlow`. These are keyed strictly by preset (`PRESET_TEMPLATES`), with the specific use case applied via post-transforms to avoid maintaining a combinatorial matrix. Auth methods can follow this exact pattern: a base template transformed dynamically based on the selected method set. The epic requires a multi-select interface covering four methods (with passkeys pre-selected and Google/GitHub flagged as "additional setup required"). Recomposing these generators around a method set rather than a preset enum represents the main CLI work in this area and remains to be fully designed.
- **The register step topology:** Social sign-up requires `sso_providers` on the `register` step, not just on the `identifier` step. Because the flow outcome model in [`3-social-login-flow.md`](3-social-login-flow.md) is purpose-independent, both single-step and multi-step topologies are functionally valid. The final choice was a CLI scaffolding decision, which is now settled in [`4-cli-provider-setup.md`](4-cli-provider-setup.md#flow-architecture-decisions) in favor of a shared entry step.
- **Breaking schema migrations:** Switching to `sso-auth-method.json` is a breaking change for one specific schema state: any payload containing `sso: {"enabled": true}` without a `providers` array. While this was valid under the legacy `auth-method.json`, it fails the new conditional validation. Existing stored schema revisions are immutable and unaffected, but attempting to re-publish or edit an affected schema body will trigger a validation error until a non-empty `providers` list is added or the `sso` block is removed. Schemas omitting the `sso` entry entirely remain unaffected.

## Exported Requirement

The two pairing validation rows live in this document rather than with the connection's validation rules because the flow definition is the sole document that references both sides simultaneously: its `user_schema` field pins the schema revision, while its `sso_providers` array names the connection slug. As a result, only flow-level validation can evaluate the exact schema-connection pair.

`claim_mapping` and `verified_claims` represent the complete intersection between these resources, as they are the only fields on a connection keyed by tenant schema property names (all other connection fields use external provider vocabulary).

- **Connection-Level vs. Pair-Level Validation:** Connection-side checks operate at the union level, flagging an error only when a key exists in *zero* referencing schemas (which signals an obvious typo). Conversely, partial per-pair overlap is standard, legitimate superset usage and remains completely silent.
- **Validation Triggers:** Flow creation and updates are the pair-check triggers. The (schema revision, provider slug) pairing itself changes only with a flow write (schema revisions are immutable, and re-pinning is a flow update), but the slug's resolved connection content can change through a connection revise with no flow write. Those writes are deliberately not server-side pair triggers: the CLI plan re-lints the whole tree on every change, and runtime superset filtering keeps a stale pairing safe (area 1, Validation vs. Runtime Safety). Pair warnings for hand-authored connection revises therefore surface at the next plan or flow write.
- **Provisional Status:** The shape and severity of these two pairing rows remain provisional, pending the resolution of schema-keyed validation in [area 1](1-resource-model.md#open-points).

Under the system's mirroring rule, all cross-resource validation rules listed in the table above must be implemented in two places: once in `validate.ts` (TypeScript CLI) and once on the server in Go. The `issuer_pattern` check is environment-contingent rather than strictly cross-resource, while the three-outcome routing check is localized entirely to the flow definition.

The Go server analog of `xAuthMethodsReader` for provider lists remains an unclaimed work item; it is tracked in area 1's [Exported requirements](1-resource-model.md#exported-requirements) to ensure it is not overlooked across document boundaries.

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1)
- [ADR 020](../../adrs/020-credentials-out-of-user-schema.md) (`x-auth-methods` as policy input)
- `packages/config/meta-schemas/auth-methods.json`, `auth-method.json`
- `packages/config/src/validate.ts` (`authMethodEnabled`, `resolveFieldChallenge`, `AUTH_METHOD_PREFIX`)
- `packages/config/defaults/default-login.json` (step shapes)
- `api/openapi/endpoints/schemas/flow-definition.json` (`SSOProvider`)
