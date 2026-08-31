# IdP Resource Model

> **Status:** Planning notes  
> **Area:** 1 of 4 (see [`README.md`](README.md))

An Identity Provider (IdP) connection is a tenant-owned configuration file that
defines how Zitadel interacts with external authentication providers (such as
Google or GitHub). This document defines the schema, validation rules, runtime behavior, and
lifecycle of these connection files.

**Note on vocabulary:**  
Commands `plan` and `apply` will be replaced by `deploy/promote/status/pull`
(see [#542](https://github.com/zitadel/nextgen/issues/542),
[#541](https://github.com/zitadel/nextgen/issues/541)).
Read "at plan" as "at validation" and "at apply" as "at deployment".

## IdP Connection Shape

A connection operates similarly to a flow definition within the Zitadel GitOps
surface.
`zitadel setup` scaffolds a prefilled file, and the tenant can edit it to
customize the behavior.

### File Structure & Identity
**Location**: One file per connection, stored under `.zitadel/idps/`.

**Identity** (`slug`): The `slug` is the stable identifier referenced by user
schemas and flow steps.

**Schema:** Validated against a Zitadel-published JSON Schema (e.g.,
`idp-connection.json`).

## Key Decisions

| Decision | Why                                                                                                                                                                                                                                                                                                                    |
| --- |------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Files under `.zitadel/idps/` | Maintains consistent GitOps surface area.                                                                                                                                                                                                                                                                              |
| Based on Zitadel-defined JSON Schema | Same pattern as `flow-definition.json`                                                                                                                                                                                                                                                                                 |
| Validation | Schema checks single-file rules; a separate validator handles cross-file rules.                                                                                                                                                                                                                                        |
| Protocol details live in a nested `oidc` / `oauth2` block | New protocols add a block instead of restructuring committed files                                                                                                                                                                                                                                                     |
| `slug` is the identity | User schemas and flow definitions reference connections by slug, so revisions never invalidate references                                                                                                                                                                                                              |
| `template` names the catalog entry | The field reads as a scaffold-source pointer; behavior comes only from the protocol blocks ([area 4](4-cli-provider-setup.md#catalog-schema)).                                                                                                                                                                         |
| Revisioned on the server | In-flight attempts, rollback, and audit need immutable revisions. The CLI syncer is `mutable: true, revisioned: false`, like the flow syncer (`ResourceSyncer`, `apps/cli/src/lib/sync/types.ts`): the server mints each revision under the stable connection id ([area 4](4-cli-provider-setup.md#preview-and-apply)) |
| `claim_mapping` | Derived based on properties in a tenant-defined user schema                                                                                                                                                                                                                                                            |
| Environment Secrets | The secret values are not configured in the connection file. How the value reaches a deployed engine is an open question; with environments ([#534](https://github.com/zitadel/nextgen/issues/534)) it blocks provider sign-in outside development setup ([Secrets and Environments](#secrets-and-environments))       |
| Vendor Configurations | Vendor differences are treated as data; see [Vendor knowledge is data](#vendor-knowledge-is-data)                                                                                                                                                                                                                      |

## Vendor knowledge is data

### Context
zitadel/zitadel implements each vendor as a Go package, and most of that code is
configuration written in Go: issuers, endpoints, forced scopes, claim mappings.
Across its vendors only three things are behaviour rather than data: 
- GitHub fetches `/user/emails` when the profile email is private and retains the
`primary && verified` address
- Apple signs its own client secret (an ES256 JWT
with a one-hour expiry, so an implementation caches and refreshes)
- Apple uses `response_mode=form_post`, which turns the callback into a POST.

### Proposal
So the proposal is: **configuration for everything data-shaped, named strategies
for the rest.**

Some providers require custom actions during sign-in, called **strategies**.
The server implements the logic for each strategy and maintains it in a
**registry**, which is a mapping of unique names to their specific implementations.
A connection activates one of these extra steps simply by referencing its
registry name (e.g., `"supplementary_fetch": "github_primary_email"`).
While standard configuration fields handle static data, only a named strategy
can introduce new execution steps.
If a connection doesn't select a strategy, it defaults to the standard protocol
flow.

While this mechanism is built for general use, Epic 851 introduces just
`supplementary_fetch` to support GitHub.
Currently, `github_primary_email` is its only entry, as GitHub is the only
provider in this release requiring a custom action.
Google’s setup, by contrast, is entirely data-driven.
When Apple is integrated later, its signed secret will introduce a second slot
(`secret_strategy`).

**Two rules keep this mechanism predictable:**

**Registry entries carry strict contracts:** A strategy explicitly declares its supported protocols, required scopes, emitted claims, and verified claims (e.g., `github_primary_email` requires the `oauth2` protocol and `user:email` scope to emit and verify an `email` claim).
The JSON schema enforces the name, protocol, and scope parts of these contracts
via closed enums and conditional checks, so typos and unshipped strategies fail
at validation.
The verified-claims part cannot be expressed that way, since it compares
each `verified_claims` key against the contract of the selected strategy; the
server covers it as [Invalid Strategy Pointer](#validator-rules).
Adding a new strategy is a non-breaking change.

**Strategies are the definitive authority:** If selected, a strategy always runs
and replaces same-named claims from userinfo or the `id_token`, so
`verified_claims: {"email": "$supplementary_fetch"}` always resolves, at the
cost of one request per login.

## Example

Setup scaffolds one file per selected provider:
[`google.json`](schemas/google.json) (OIDC, discovery supplies the endpoints)
and [`github.json`](schemas/github.json) (OAuth2, no discovery, endpoints
explicit).
The connections contain env var references, they never include secret values. They both carry a
`claim_mapping` generated from the active user schema.

Tracking is handled by `state.json` (`ResourceEntry`: `id`, `hash`, `name`,
`status`, `previousId`), with `scaffoldedFrom` proposed as an addition; see
[Open points](#open-points).

## The connection schema

The full draft can be found at [`schemas/idp-connection.json`](schemas/idp-connection.json).

How to read the schema:

- **Root vs. Protocol Blocks:** The root level defines universal requirements:
  identity (`slug`, `protocol`, `template`, `display_name`), resolution
  (`subject_claim`, `claim_mapping`, `verified_claims`), and trust
  (`provisioning.creation`).
  Protocol-specific plumbing is isolated inside nested blocks.
- **Protocol Selection:** The `protocol` field dictates the active block.
  Using `if protocol == "oidc"` requires the `oidc` block and explicitly forbids
  `oauth2`.
- **Precise Error Messages:** The schema uses `if`/`then` conditionals rather
  than `oneOf`.
  While `oneOf` throws generic "all arms failed" errors, `if`/`then` pinpoints
  the exact issue (e.g., `/oidc must have required property 'client_id'`).
- **Intentional Duplication:** The two protocol blocks duplicate nine shared
  fields.
  Factoring them out would require `unevaluatedProperties`, which many
  third-party validators do not support.
  Since a connection file only ever contains one block, this duplication is
  safer and more compatible.
- **Scope Enforcement:** In the OIDC block, `scopes` must contain `openid`
  (enforced via `required` and `contains`, as JSON Schema `default` values do
  not inject data).
  Without `openid`, it is not a valid OIDC connection.
- **Subject Claims:** The `subject_claim` field is optional for OIDC (the spec
  guarantees `sub`, though overrides exist for pairwise IDs like Entra) but
  strictly required for OAuth2.
- **Strict Secrets:** Literal secrets cannot be committed.
  Because the schema objects are strict and no `client_secret` property exists,
  pasting a raw secret triggers an immediate validation error.
- **Editor and UI Affordances:** The `format: "uri"` rule is just an annotation
  for editor linting (per Draft 2020-12).
  `template` names the catalog entry the file was scaffolded from and keys
  vendor knowledge only (glyphs and button branding, the setup scan/match, and
  catalog claim tables); it carries no protocol behavior.
  The engine copies `display_name` and `template` onto the rendered step's
  provider entry, so the flow definition lists only slugs
  ([area 2](2-auth-method-selection.md#rendering-from-the-connection)).
- **TLS Required:** Every endpoint URL (`issuer`, `jwks_uri`, and the endpoints
  in both blocks) carries a `pattern` requiring `https://`, with an exception
  for local development (`http://localhost` and `http://127.0.0.1`).
  OIDC requires TLS on these endpoints, and every one of them handles codes,
  tokens, or key material; `format: "uri"` alone is an annotation and would not
  reject an `http://` URL.
- **PKCE and claim source:** Both protocol blocks carry `pkce_enabled` (default
  `true`; set `false` only for a provider whose token endpoint rejects the
  parameters).
  The challenge method is not configurable, the engine always uses `S256`
  ([The `state` Record](3-social-login-flow.md#the-state-record)).
  The OIDC block adds `id_token_mapping` (default `false`), which reads claims
  from the `id_token` instead of `userinfo`.
- **Future-Proof Terminology:** "Claim" is used as a protocol-neutral term for
  any provider assertion (whether OIDC claims, OAuth2 userinfo, or future SAML
  attributes), ensuring root field names remain stable as new protocols are
  added.

### Provisioning

`creation` determines what the engine does with an unknown subject. zitadel/zitadel
expresses the same thing as two booleans
([`oidc/oidc.go#L41-L60`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/oidc/oidc.go#L41-L60)
`WithCreationAllowed` / `WithAutoCreation`), four states behind two bits.
This design names the states instead.

| `creation` | Legacy bits | Unknown subject                                                                                                                                                                                                                                                                                                                                                                  |
| :--- | :--- |:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `disabled` | allowed=false, auto=false | The provider signs in existing users only. An unknown subject is an error on the step the user started from; the step re-renders with the error and the user picks another signin method. `identity_unknown` is not raised as its target is the collection step, which only applies to providers that may create users ([area 3](3-social-login-flow.md#the-three-outcomes)).    |
| `auto` (default) | allowed=true, auto=true | The user is created automatically when claim mapping resolves all the required user fields. Otherwise the collection step is shown for manual creation, prefilled with the known fields from claim mapping.                                                                                                                                                                      |

In the case of `auto`, the user is not created if a required `x-unique` property arrives as unverified. 
The collection step is shown instead for manual creation ([area 3](3-social-login-flow.md#creation-without-collection-creation-auto)).

Two further states deferred to future work:

- `auto_only` (allowed=false, auto=true) creates the user when claim mapping
  resolves every required property, and fails when it
  does not.
  It never prompts for user input, which is the "trust the provider, no user input" mode of
  zitadel/zitadel#8420.
  When `x-verify` is available, an unverified required `x-unique` property also fails.
- `collect` (allowed=true, auto=false), always the collection step, is not
  planned.
  Wanting the user to stop means wanting a property from them, and a required
  property the provider cannot supply already forces collection under `auto`.
  Editing prefilled verified values only drops their verification.

**A ceiling, not a policy.**
The connection states how far this provider's data is trusted, which varies by
provider.
Whether a given user type may sign up at all is a property of the user type,
owned by authentication method settings
([#898](https://github.com/zitadel/nextgen/issues/898)). #898 states that the
effective rule is the intersection, so that policy can narrow the connection's
value (a Google connection at `auto` serving Customers at `auto` and Employees
at `disabled`) and never widen it.
The connection is the only layer that exists in 851.
Recorded under [Product decisions](README.md#product-decisions).

*Note:* The legacy flags that governed account linking (`is_linking_allowed`,
`auto_linking`) have been removed from this initial release.
See [Linking safety](#linking-safety) for details.

### Deferred and Cut Fields

Several fields have been intentionally excluded from the initial schema based on
a strict rule: **nothing is selectable without a backing implementation**.
When these features are eventually built, they will be reintroduced as additive,
non-breaking changes.

| Deferred Field | Return Condition / Status |
| :--- | :--- |
| `secret_strategy` & `secret_params` | When Apple integration is scoped (required for Apple's signed secret). |
| `response_mode` (`form_post`) | When Apple is scoped (the current 851 callback supports GET only). |
| `dynamic_authorize_parameters` | Once a design exists for sourcing runtime values in the authorize URL. |
| `is_linking_allowed`, `auto_linking` | When the deferred account-linking journey is designed and implemented. |
| `creation: auto_only` | When the engine has the error branch for incomplete claims ([Provisioning](#provisioning)). Additive enum value. |
| `is_auto_update` | When per-property verification state exists |
| `enabled` | **Not planned.** An unlisted connection is already inert. Furthermore, a config flag is a poor mechanism for an emergency disable (due to release latency, and rollbacks would inadvertently re-enable it). Imperative runtime disabling remains an open point. |
| `kind`, `audience`, `default_schema` | **Cut completely.** No identified use case or need. |

## Claim Mapping

The `claim_mapping` block translates the tenant's internal property names (keys)
into the external provider's claim names (values):

```jsonc
"claim_mapping": { "email": "email", "givenName": "name", "employeeId": "login" }
```

- **Multi-Schema Support:** A single connection can serve multiple schemas.
  Each schema simply filters the mapping, consuming only the properties it
  defines and safely ignoring the rest.
- **Seeded, then owned:** The CLI seeds the `claim_mapping` block during initial
  scaffolding by intersecting the provider catalog's claim table with the active
  schema's property names (matching strictly by name) to ensure the file never
  starts with unknown targets.
  For any remaining unmapped properties, tenants must manually add rows mapping
  their local property name to the exact claim name found in the provider's
  documentation.
  Once scaffolded, this block is strictly tenant-owned; re-running the setup
  journey will only append new mappings and will never overwrite existing rows.
- **Known Limitation:** If two schemas use the exact same property name but need
  it populated from different provider claims, they cannot share a connection.
  The workaround is to create a second connection with a distinct `slug`.
- **No Annotation Conflicts:** The currently unused `x-claim` annotation on user
  properties names "the claim name for this property, if applicable"
  (`user-property.json`), the outgoing side; it does not conflict with this
  incoming mapping.
- **Catalog Data Caveat:** GitHub exposes no given/family name split; its `name`
  claim is the full display name.
  The catalog claim table still maps `givenName: "name"` as the pragmatic
  default, which puts a full name into `givenName`.
  Tenants wanting precise name semantics drop that mapping, and the user
  supplies the value at the collection step.
  `familyName` has no GitHub source and is never mapped.
- **Validation vs. Runtime Safety:** Unknown-target checks run at plan, against
  every referencing schema; the CLI reads the working tree, and the server
  validates during flow definition creation and update.
  At runtime the flow's pinned schema revision filters the mapping; unmatched
  keys are ignored.
  A connection create or revise triggers no server-side pair check: the CLI
  re-lints every pair on any working-tree change, and for hand-authored API
  writes the runtime filter is the safety net, so their warnings lag until the
  next plan or flow definition write.

The `verified_claims` field is the companion map for verification state,
offering three value forms:

| Value | Meaning | Exists because |
| :--- | :--- | :--- |
| `"email_verified"` | Read this claim. | OIDC providers assert verification in a specific claim. |
| `true` | Trust this provider unconditionally. | Entra-style stated trust requires it. |
| `"$supplementary_fetch"` | The selected fetch strategy verifies it. | GitHub verification relies on a `primary && verified` fetch result, not a single claim. |

A `$`-prefixed value acts as a pointer to the strategy field of the same name in
the protocol block.
For instance, `"$supplementary_fetch"` defers to whatever the
`supplementary_fetch` field selects.
The strategy's backend contract (its server-side definition) must declare in
its registry entry that it verifies the claim that the `verified_claims` key
maps to (see [Invalid Strategy Pointer](#validator-rules)).
If the pointer does not select a strategy, or the strategy cannot verify that
claim, the server rejects the connection.

All `$` values are reserved.
Only `$supplementary_fetch` exists, so any other `$` string is a schema error.
A typo in a plain claim name fails silently (claim names are provider-controlled
and unchecked at plan time); a typo in a `$` value fails hard.
One slip is out of reach of the schema: `"true"` in quotes is a claim name, not
the boolean, so the engine looks for a claim named `true`, finds none, and
evaluates the property as unverified on every attempt.
Any string is a valid claim name, so the schema cannot reject it; the validator
warns on the literal `"true"` and `"false"` instead.

The list of allowable pointers will grow only when a new claim-verifying
strategy *slot* is added, requiring just one `const` per slot, making it a
non-breaking change.
Introducing new strategies to an existing slot requires no schema changes,
because the pointer references the field name, not the specific strategy.

## Linking Safety

Epic 851 does not include account linking.
The linking fields are excluded from the schema, and the engine has no linking
path.
This section records the analysis that a future linking implementation must
inherit to avoid security flaws:

- **Email linking requires verified claims:** Auto-linking accounts based on
  unverified emails is an account takeover risk.
  OAuth2 `userinfo` lacks verification semantics, and some OIDC providers allow
  tenant admins to set arbitrary emails (such as the nOAuth attack against
  Entra).
  Therefore, auto-linking by email must strictly require verified-email
  coverage.
- **Linking rules are cross-resource:** Tenants name their own properties, and
  the referencing user schema's annotations decide which property acts as "the
  email".
  The connection does not know that, so a check hardcoded on the literal name
  `email` would break for a tenant who calls their property `emailAddress`.
  The linking rule therefore belongs in the validator and the engine, not in the
  connection schema.
- **Username matching limitations:** Username matching has no verification
  equivalent.
  Subject-based matching is the only strongly secure variant.
- **Subject matching is not schema-aware:** Because a single connection can
  serve multiple schemas, one Google account might legitimately back both a
  "Customers" and an "Employees" user.
  The identity link key (`connection`, `subject`) is schema-agnostic, while user
  records (`users.schema_url`) and flow definitions (`user_schema`) are each
  bound to a single schema.
  Consequently, a subject lookup during a flow could return a user record
  belonging to a different schema than the active one.
  Before identity linking can safely match on a subject, the design must resolve
  whether identity spaces are isolated per schema or shared across the project
  ([area 3](3-social-login-flow.md#open-points)).

The `verified_claims` field is included in the 851 schema so the committed
configuration shape stays stable when future capabilities arrive.
In this release, its only reader is the `x-unique` auto-creation gate
([Provisioning](#provisioning)); the per-property results ride on the resolved
external identity and are not persisted.
Broader property gating and persistent on-user verification state come back with
`x-verify`, as does the deferred `is_auto_update`.

**The `x-verify` Dependency:** Although `x-verify` was temporarily removed from
the dialect in [PR #901](https://github.com/zitadel/nextgen/pull/901) due to
lack of use, this design acts as its first future consumer, so all references
here describe its planned return shape rather than the shipped dialect.
[`user-property.json`](../../../packages/config/meta-schemas/user-property.json)
today carries only `x-unique`, `x-claim`, and `x-audit`.
While basic gating at the callback's verification evaluation
([area 3](3-social-login-flow.md#callback-processing)) requires only the
annotation, advanced capabilities such as recording verification at creation,
dropping verification on edits, and enforcing the `is_auto_update` downgrade
guard depend on per-property state tracking that does not yet exist.
Because of this missing infrastructure, `is_auto_update` is explicitly deferred
rather than shipped as a no-op.
When `x-verify` is reintroduced to activate the paired `verified_claims`
validator rules, the `x-verify` definition must tighten from a free-form string to
a strict enum of implemented methods.

## Validator Rules

These are cross-file and state-dependent rules that a single-file JSON schema
cannot express.
They are implemented in two places: the TypeScript CLI validator (which reads
the working tree and CLI state during the validation phase) and the Go server
(which mirrors the rules where it has the inputs; its schema-connection share is
enforced when flows are created or updated, as detailed in the
[validation rules](2-auth-method-selection.md#validation-rules)).
The checks comparing `claim_mapping` and `verified_claims` against schemas are
provisional (see [Open points](#open-points)).

| Rule / Constraint | Severity | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| :--- | :--- |:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Slug Uniqueness** | Error | `slug` must be unique across all `.zitadel/idps/` files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Slug Modification** | Error | Cannot change the `slug` on a state-tracked file. A true rename requires creating a new one (see [Lifecycle](#connection-lifecycle)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Identity-Critical Revision** | Error | An identity field changed on a state-tracked connection. For `oidc` these are `protocol`, `subject_claim`, and `issuer`; for `oauth2` they are `protocol`, `subject_claim`, `token_endpoint`, and `userinfo_endpoint`. Identity links key on the connection id, so the edit would hand existing accounts to whoever holds the same subjects at the new authority. Like slug, these fields are fixed for the life of a connection; a real change is a new connection (see [Lifecycle](#connection-lifecycle)). OIDC endpoint overrides (`jwks_uri`, `token_endpoint`, `userinfo_endpoint`) may be added, changed, or removed. The `issuer` pins the authority on its own, because the `id_token` must carry it as `iss` and discovery must return it ([area 3](3-social-login-flow.md#callback-processing)), so an override is a repair, not a change of who answers for a subject. State records a content hash, not field values (`ResourceEntry`, `apps/cli/src/lib/sync/types.ts`), so the CLI can name the changed field only by fetching the stored revision; the server's refusal on revise is the authoritative one.                                                                                                                                                  |
| **File Move** | *Handled* | An orphaned state entry paired with a new file using the same `slug` is treated as a file move. State is rekeyed, and the platform is not touched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Orphaned Mapping Target** | Error | A `claim_mapping` target is unknown to *every* referencing schema (assumes at least one schema references the connection). This typically indicates a typo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Missing Mapping Target** | Warning | A `claim_mapping` target is missing from *some* referencing schemas. This is permitted because a connection can legitimately map a superset of fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Orphaned Verification Key** | Error | A `verified_claims` key is unknown to *every* referencing schema. A typo here means the claim will silently never verify.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Unreferenced Typo Guard** | Warning | The connection is not referenced by any schema, and a mapping target or verification key is unknown to *every* schema in the working tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Missing `x-verify` Method** | Warning | A `verified_claims` key points to a property that lacks an `x-verify` method (verification with nowhere to land). Activates when `x-verify` returns (see the dependency note under [Linking Safety](#linking-safety)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Invalid Strategy Pointer** | Error | `"$supplementary_fetch"` with no strategy selected, or a strategy that does not verify the mapped claim. The key is a property name and the contract lists claim names, so the check maps the key through `claim_mapping` first: with `github_primary_email`, `emailAddress` → `email` passes and `givenName` → `name` fails. A key with no `claim_mapping` entry cannot resolve and is an error. Server-side only: the contracts live in the server's registry, so the CLI does not run this check at plan and the error surfaces at apply.                                                                                                                                                                                                |
| **Literal `"true"` Source** | Warning | A `verified_claims` source is the quoted string `"true"` or `"false"`. Any string is a valid claim name, so the schema cannot reject it, but the engine would look for a claim by that name, find none, and evaluate the property as unverified on every attempt. The boolean `true` is the trust-the-provider form. |
| **Inert Connection** | Warning | The connection is referenced by zero schemas. No flow can offer it, making it completely inert.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Impossible Registration** | Warning | A flow registration step offers this provider, but `creation` is `disabled`. The user will never be able to sign up: an unknown subject is an error on the step, and `identity_unknown` is not raised ([Provisioning](#provisioning)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Impossible Auto-Creation (Data)** | Warning | `creation` is `auto`, but a referencing schema requires a property that the `claim_mapping` does not target. Every sign-in will stop to collect the missing data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Impossible Auto-Creation (Verification)** | Warning | `creation` is `auto`, but a referencing schema requires an `x-unique` property (851) or an `x-verify` property (when `x-verify` returns) that lacks a `verified_claims` entry. Absent entries evaluate as unverified, so the auto-creation condition can never pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Mutable Subject Claim** | Warning | Using a mutable claim like `email`, `login`, `preferred_username`, `username`, or `name` as the `subject_claim` introduces an account-hijacking risk: if the external provider ever reassigns that value to a new person, the new user will silently inherit the original holder's account. To prevent this, the catalog safely defaults to scaffolding immutable identifiers, such as Google's `sub` or GitHub's `id`. Furthermore, because the `subject_claim` is permanently fixed for the lifecycle of the connection, the system will explicitly warn the developer prior to the first apply if a potentially reassignable claim is configured.                                                                                      |
| **Missing Env Vars** | Error / Warning | Referenced environment variables are missing from the local environment. Interactive journeys and the test command's local env check raise `E_CREDENTIAL_MISSING` as an error (the developer is present to fix it). That check only confirms the variables are set; the live credential probe against the provider is deferred ([README](README.md#scope-for-851)). Batch `plan` only warns, so one IdP file cannot force secrets into every CI pipeline; the authoritative presence check belongs to release-to-environment time, once the secret store exists ([#534](https://github.com/zitadel/nextgen/issues/534)) (see [Upstream Security Pushback](#upstream-security-pushback)). Shipped `assertEnvRefs` hard-fails `plan` for schemas and flows today, so the batch relaxation is a deliberate change.                                                                                                                                                                                            |
| **Literal Secret** | Error | A hardcoded `client_secret` is present (returns a friendly error message, though the schema strictly rejects it anyway).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Reserved Authorize Parameter** | Error | A `static_authorize_parameters` key names an engine-owned protocol parameter (`client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `nonce`, `code_challenge`, `code_challenge_method`) or one the engine reserves (`response_mode`, `request`, `request_uri`: the callback accepts the query response mode only, and the engine composes the request itself), or a credential (`client_secret`, `client_assertion`). A config override of `state` or `nonce` would silently defeat CSRF and token binding, and a credential here would be committed to source control and appended to the public authorize URL. The schema's `propertyNames` already rejects the keys; this rule restates the failure with a friendly message. |
| **Cleartext Endpoint** | Error | An endpoint URL (`issuer`, `jwks_uri`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`) is not `https://`. The schema `pattern` already rejects it, with a `http://localhost` / `http://127.0.0.1` exception for local development.                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Immutability and Revisions

Editing a connection publishes a new, immutable revision rather than modifying
it in place.
The previous revision continues to exist.
This design serves three critical purposes:

- **Stable Auth Attempts:** An SSO attempt spans an external redirect.
  Configuration is read when building the authorize URL and again minutes later
  during the code exchange.
  To prevent mid-flight changes, an attempt binds to a specific revision when it
  starts and finishes on that exact same revision.
- **Reliable Rollbacks:** A release inherently pins a specific revision of every
  resource (per ADR 035).
  If connections were mutable, there would be no static state to pin for a
  rollback.
- **Built-in Auditing:** Immutable revisions provide a free audit trail (e.g.,
  tracking exactly who changed a client ID, and when).

*Note:* Rotating a secret does not create a new revision because the
configuration file only stores the environment variable name, not the secret's
value.
(Flow definitions become immutable revisions too in
[#530](https://github.com/zitadel/nextgen/issues/530), correlated by name rather than
under an outer id).

## Referencing by Slug

Upstream resources, such as schemas (`x-auth-methods.sso.providers`) and flow
steps (`sso_providers`), always reference connections by their `slug`
(e.g., `google`), never by their revision ID.

- **No cascade:** A new connection revision means a new revision id; references
  by slug also avoid cascading changes to user schemas and flow definitions.
- **Restoring Determinism:** The trade-off of referencing a slug is late binding
  (the name `google` does not explicitly state which revision should run).
  To maintain strict determinism, two exported mechanisms handle resolution:
  1. The auth attempt binds the current revision at the exact moment it starts.
  2. The release bundle securely records which revision each slug resolved to at
     the time of construction.

## Connection Lifecycle

- **Slugs cannot be renamed in place:** Schema and flow references, and the
  release's slug resolution, bind to the name, so the validator refuses the
  edit.
  Create a new connection with the new slug, update the references, and retire
  the old one on its own schedule.
- **Renaming a file is a move:** State is keyed by file path, so a `git mv`
  would look like a delete and a create.
  The planner pairs an orphaned state entry with the new file carrying the same
  slug and rekeys without touching the platform; slugs are unique, so the
  pairing is unambiguous.
  Renaming the file and changing the slug at once is a delete and a create.
- **Deletion:** Open, decided with the CRUD API; it must not break a live flow
  ([Open Points](#open-points)).
- **Identity links key on the connection id:** Users created through a provider
  hold identity links tied directly to the connection's unique ID.
  To guarantee these links survive safe edits and are never inherited by
  unrelated connections, the CRUD API enforces strict mutation rules:
    - **Stable IDs:** A connection has two ids.
      The connection id is minted once at create and is what identity links
      reference.
      Each edit stores a new immutable revision under it with its own revision
      id, which attempts and releases pin.
      The split keeps the link target stable while still letting an attempt or a
      release name the exact configuration it ran against.
      Slug uniqueness and the identity fields belong to the connection, not the
      revision.
    - **Slug Reuse:** If a connection is deleted and its slug is reused, the new
      connection receives a brand new ID, protecting the old links.
      *(Note: Whether a retired slug remains permanently reserved to prevent
      schema and flow references from resolving to the new connection is an open
      question tied to the deletion design).*
    - **Immutable Authority Fields:** Changing *who* answers for a subject
      (e.g., the `issuer` or `subject_claim`) while keeping the same connection
      ID would cause silent account takeover: subject `12345` at a new issuer
      would inherit the account of subject `12345` from the old one.
      Therefore, these fields are fixed for life.
      The validator and server will explicitly refuse such edits as an
      **Identity-Critical Revision**.
      For OIDC the `issuer` alone names the authority, so the endpoint
      overrides stay editable; adding a `jwks_uri` when a provider's discovery
      document breaks is a repair on the same connection.
    - **Authority Migrations:** A true authority change requires creating a new
      connection with a new ID, and users must sign up again under it.
      Preserving links across an authority change is not included in this
      design.

**What a revision may change**: A connection's core identity is defined by its
slug, its authority, and its subject rule.
Everything else forms the mutable revision body.

| Fields | On a state-tracked connection |
| :--- | :--- |
| `slug` | **Fixed.** A rename requires creating a new connection ([Slug Modification](#validator-rules)). |
| `protocol`, `subject_claim`, and the authority: `issuer` for `oidc`, `token_endpoint` and `userinfo_endpoint` for `oauth2` | **Fixed.** These define *who* a subject is; altering them requires a new connection ([Identity-Critical Revision](#validator-rules)). |
| `client_id`, `client_secret_env`, `scopes`, `static_authorize_parameters`, `token_endpoint_auth_method`, `pkce_enabled`, `id_token_mapping`, `authorization_endpoint`, the OIDC overrides `jwks_uri`, `token_endpoint`, and `userinfo_endpoint`, `supplementary_fetch`, `claim_mapping`, `verified_claims`, `provisioning`, `display_name`, `template` | **New revision.** Safely mutates the configuration. <br><br>*(Note: Generating a new OAuth app/`client_id` at the same authority safely retains the subjects because Google's `sub` and GitHub's `id` are global to the user account. Providers issuing pairwise subjects, computed per sector, so a new app under a different redirect host gets new subjects, turn this into orphaned links and duplicate users; that is a custom-provider question).* |
## Secrets and Environments

**What is currently implemented:** The file convention.
Files store variable names (e.g., `client_secret_env`), scaffolding
automatically gitignores `.env*` files, and file bodies are uploaded verbatim.
Rejecting a literal secret is new in this design
([Literal Secret](#validator-rules)).

**What is missing:** Everything after the file upload.
There is currently no secret store, resolution step, or rotation path designed.
The nearest specification,
[`configuration-surface.md`](../platform/configuration-surface.md), explicitly
defers the secret-store design.

This document outlines the strict constraints that any future secret lifecycle
design must satisfy:

| Ruled Out Approach | Reason |
| :--- | :--- |
| **Client-side resolution** (uploading the resolved value in the document) | Every immutable revision would permanently embed the secret. Leaks could never be scrubbed, rollbacks would reactivate revoked secrets, and plan diffs would expose secret material in Git and CI logs. |
| **Server-side OS resolution** (server reads from its own environment) | This only works for self-hosted setups. In a multi-tenant system, operators would be forced to inject every tenant's secrets into the core engine configuration. |

**The Surviving Pattern:** The configuration file stores the variable name, the
value is delivered out of band, and the engine joins them at runtime.
This allows secrets to be rotated via a store write without publishing a new
config revision, and it keeps values safely outside the release boundary.
The store and its API are undesigned, so this stays an open question, not a
decision.

**Strict Invariant:** Secret resolution must never happen upstream of anything
that is diffed, hashed, committed, or printed.

### Open Challenges

- **Rotation:** Rotation is a critical emergency path.
  Because change detection hashes the file body, a "rotate-then-apply" action
  would silently skip execution ("no change") during an incident.
  The secret value never appears in the file, so a successful apply and a
  rotation the engine never received look identical.
  The final design needs a mechanism to positively confirm that the engine holds
  the new secret value.
- **Per-environment non-secrets:** Values like `client_id` differ between
  environments (e.g., dev vs. prod).
  While `${VAR}` syntax exists, resolution does not.
  Because a release deploys the exact same file revision to every environment,
  these variables cannot be resolved directly into the file.
  The reference must reach the engine and resolve against the environment there.
  To support single-environment projects natively, the configuration field
  accepts either a literal string or `${VAR}` syntax without requiring a
  separate `client_id_env` field.

### Upstream Security Pushback

Before the deferred secret-store specification is finalized, the following
architectural constraints must be addressed:

- **Write-only production stores:** The proposed "read-back" store, where
  teammates authenticate and fetch per-environment secrets
  ([`configuration-surface.md`](../platform/configuration-surface.md)), is an
  anti-pattern until its blast radius can be quantified.
  It puts production secret material within reach of a client credential
  without saying what a read is authorized against.
  Production values must be writable by the deployment identity, readable
  exclusively by the engine, and never fetchable by local developer setups.
- **Scoping the presence check:** Requiring secret validation before a plan
  runs means one file carrying a secret reference makes every CI pipeline that
  runs `plan` demand secrets, even for unrelated PRs.
  The plan phase should only issue warnings.
  A local presence check is only meaningful where the local environment is the
  engine's, because the CLI uploads the variable name and never the value.
  Strict presence checks should be answered at release-to-environment time,
  once the secret store exists ([#534](https://github.com/zitadel/nextgen/issues/534)).
  Until then, a missing secret is first seen when a sign-in reaches the token
  exchange.
  The validator rules adopt this split: `E_CREDENTIAL_MISSING` stays an error
  inside interactive journeys and the test command's local env check, and
  batch `plan` warns.
- **Encryption minimums:** Stating "encrypted at rest" is insufficient.
  The architecture must guarantee per-tenant envelope keys, engine-only
  decryption, and a strictly write-only external API surface.

## Forward Compatibility

Connection files are committed to version control and entirely tenant-owned.
Therefore, any schema change that invalidates existing files is treated as a
required migration, not just a standard release.

| Change Type | Breaking? |
| :--- | :--- |
| Adding an optional property, a new enum value, a new protocol block, or relaxing a requirement. | No |
| Adding a required property, tightening a constraint, or adding new requirements to an existing enum value. | **Yes** |

This is why unimplemented values are excluded: a placeholder that gains
requirements later breaks existing files.
The receipt suite checks that a future schema with Apple's fields
(`secret_strategy`, `secret_params`, `response_mode`) validates every file that
passes today.

**Reverse Compatibility:** The reverse direction is intentionally not protected.
An older version of the validator will actively reject a newer file containing
unknown fields.
This is the accepted trade-off required to maintain strict and effective
typo-catching.

## Dependencies

Behaviors this design relies on but does not implement.

| Requirement | Owed By |
| :--- | :--- |
| A stable `slug` is the connection's identity: user schemas and flow definitions reference connections by slug only, never by revision id. | [`2-auth-method-selection.md`](2-auth-method-selection.md) |
| An SSO attempt must bind to a specific connection revision at the exact moment it starts. | [`3-social-login-flow.md`](3-social-login-flow.md) |
| An absent verification claim must be evaluated as unverified (fail closed). | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine |
| Truthiness evaluation must strictly accept only boolean `true` or string `"true"`. | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine |
| `is_auto_update` must never silently overwrite a verified property with an unverified value. | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine |
| Strict linking coverage rules must be enforced when the feature returns. | Deferred account-linking journey |
| Slug-to-revision resolution must be securely recorded during release-bundle construction. | [#545](https://github.com/zitadel/nextgen/issues/545) bundle constructor, under the [#529](https://github.com/zitadel/nextgen/issues/529) releases epic |
| The API surface must support `get-by-slug` and strictly enforce uniqueness on creation. | Server CRUD API |
| A unique, revision-stable connection id must be established to safely maintain user identity links. | Server CRUD API + Deletion semantics |
| The identity fields (`protocol`, `subject_claim`, `issuer`, `jwks_uri`, `token_endpoint`, `userinfo_endpoint`) belong to the connection, not the revision: a revise whose body changes one is refused, as a slug change is. Hand-authored API writes bypass the CLI check. | Server CRUD API |
| A resolved client-secret value must be obtainable during the token exchange step. | Deferred secret-store spec (production); the development-runtime env join is [#851](https://github.com/zitadel/nextgen/issues/851) execution work (see [Open Points](#open-points)) |
| A presence check for each referenced secret, per environment, at release deployment. | Secret-store design ([#534](https://github.com/zitadel/nextgen/issues/534)), under the [#529](https://github.com/zitadel/nextgen/issues/529) releases epic |
| The server must validate every connection body against `idp-connection.json` at create and revise, before a revision is stored. Client-side validation does not cover hand-authored API writes (ADR 035 keeps direct CRUD first-class), and revisions are immutable, so a stored literal secret could never be scrubbed. | Server CRUD API |
| The Go server must mirror and enforce the error-grade cross-resource validator rules where it has the inputs. | Server validator |

## Open Points

- **`scaffoldedFrom` tracking:** An optional string on `ResourceEntry` recording
  which shipped default generated a file, the merge base for upgrading
  scaffolded defaults later.
  Record it now; it cannot be reconstructed afterwards.
- **The secret lifecycle:** The actual mechanics of the secret lifecycle (the
  store, the set-surface, the engine join, and rotation) are owned by the
  deferred secret-store specification.
  This document only contributes the structural constraints and the security
  pushback outlined in the section above.
  That ownership covers production.
  Development cannot wait for the spec: the local runtime gets the CLI process
  environment plus two fixed server variables
  ([`binary.ts`](../../../apps/cli/src/lib/local-server/binary.ts)) or two fixed
  docker `--env` values
  ([`docker.ts`](../../../apps/cli/src/lib/local-server/docker.ts)); nothing
  loads `.env.local`, and `plan` checks env refs against `process.env` alone, so
  no configured provider can complete a token exchange.
  Wiring the development join is
  [#851](https://github.com/zitadel/nextgen/issues/851) execution work, under
  the same never-upstream invariant; area 4 owns it
  ([Dependencies](4-cli-provider-setup.md#dependencies)).
- **Imperative runtime disable:** A way to disable an IdP imperatively at
  runtime is still needed (e.g., `zitadel idp disable google --env prod`).
  This mechanism must be per-environment, execute in seconds, and remain immune
  to config rollbacks.
  Because of these requirements, it must be specified as part of the runtime
  surface, never as a configuration field.
  Attempts pin a revision at start
  ([Immutability and Revisions](#immutability-and-revisions)), so the disable is
  checked again at callback; otherwise it takes effect only for new attempts.
- **Deletion semantics:** A choice must be made between a "refuse-while-pinned"
  approach (which requires a grace window for in-flight attempts) and a
  "tombstoning" approach.
  Decided with the CRUD API design.
- **Deletion must not break a live flow:** Flows and schemas reference a
  connection by slug, and nothing in the design refuses a delete while a flow
  references the slug, so a live login page could render a button whose attempt
  cannot start.
  Either the delete is refused while a live flow's pinned schema lists the slug
  (needs the cross-resource reader, scoped to live pins, or nothing is ever
  deletable), or the engine hides a provider whose slug no longer resolves when
  it renders the step, and an in-flight attempt ends in error
  ([area 3](3-social-login-flow.md#constraints--edge-cases)).
  Neither the refuse-while-pinned nor the tombstoning model answers this: both
  govern in-flight attempts, not flow references to the slug.
- **Schema-keyed validation:** One connection may serve several user schemas,
  so `claim_mapping` and `verified_claims` may name properties of several
  schemas (the superset model).
  How strictly those keys can be checked is open, because a typo and a key
  meant for another schema look alike to the validator.
  Example: a Google connection serving Customers (`email`, `firstName`) and
  Employees (`email`, `department`) legitimately maps all three, so a key that
  only some referencing schemas define can only warn; a key that none defines
  is an error.
  The CLI sees every referencing schema and applies both rules; the server sees
  none during connection creation, so the error-grade half runs during
  flow-definition writes (as a flow definition is the only document that
  references both a schema revision and a connection slug) and the
  warning-grade half is CLI-only.
  A 1:1 rule (one connection per schema) would allow error-grade checks
  everywhere, but it contradicts the epic and duplicates connection config and
  credentials per schema.
  The validator rules record the superset status quo.
- **Catalog claims schemas:** The provider side of a mapping row is unchecked
  at plan time.
  The validator verifies that a `claim_mapping` key names a schema property,
  but any string passes as the claim-name value, because nothing records which
  claims a provider emits.
  A typo'd value fails silently at runtime.
  The claim is never found, so the property stays unmapped, and a typo'd
  `verified_claims` source evaluates as unverified on every attempt.
  The knowledge to catch this already exists.
  The area 4 catalog carries each vendor's claim table, and strategy registry
  entries declare their emitted claims.
  Promoting that knowledge to a small claims schema per catalog entry would let
  the plan warn on a claim name `google` or `github` is not known to emit.
  A warning, not an error, because extra scopes can unlock claims the catalog
  does not list.
  Custom providers have no catalog entry and keep today's unchecked behavior.
  It is also the base for any future typed or expression mapping.
  Not 851 work.
- **The CRUD API itself:** Currently, no IdP API exists.
  Building the endpoints, generated client, and handlers represents the largest
  pending work item in this domain.

## Related

- [ADR 007](../../adrs/007-gitops-configuration-surface.md): GitOps
  configuration surface
- [ADR 035](../../adrs/035-configuration-environments.md): releases and
  environments
- [ADR 042](../../adrs/042-scaffolded-file-ownership-and-drift-detection.md):
  scaffolded app-file ownership; extended here by analogy
- [ADR 020](../../adrs/020-credentials-out-of-user-schema.md): `x-auth-methods`
  as policy input
- [`../cli/identity-surface.md`](../cli/identity-surface.md): earlier draft of
  this resource
- [`../platform/configuration-surface.md`](../platform/configuration-surface.md):
  secrets, environments (written before ADR 035; its `push` is ADR 035's
  `deploy`)
- `api/openapi/endpoints/schemas/flow-definition.json`: `SSOProvider`, `Gate`
- `apps/cli/src/lib/sync/`: `ResourceSyncer`, state, sync loop
