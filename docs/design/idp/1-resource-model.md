# IdP Resource Model

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 1 of 4 (see [`README.md`](README.md))

An Identity Provider (IdP) connection is a tenant-owned configuration file that defines how Zitadel interacts with external authentication providers (such as Google or GitHub).

This document defines the schema, validation rules, runtime behavior, and lifecycle of these connection files.

**Note on vocabulary:**  
Commands `plan` and `apply` will be replaced by `deploy/promote/status/pull`
(see [#542](https://github.com/zitadel/nextgen/issues/542)).
Read "at plan" as "at validation" and "at apply" as "at
deployment".

## IdP Connection Shape

A connection operates similarly to a flow definition within the Zitadel GitOps surface. Setup scaffolds a prefilled file, and the tenant owns it entirely afterward.

### File Structure & Identity
**Location**: One file per connection, stored under `.zitadel/idps/`.

**Identity** (`slug`): The `slug` is the stable identifier referenced by user schemas and flow steps.

**Schema:** Validated against a Zitadel-published JSON Schema (e.g., `idp-connection.json`).

## Key Decisions

| Decision                                                  | Why                                                                                                                       |
|-----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| Files under `.zitadel/idps/`                              | Maintains consistent GitOps surface area.                                                                                 |
| Based on Zitadel-defined JSON Schema                      | Same pattern as `flow-definition.json`                                                                                    |
| Validation                                                | Schema checks single-file rules; a separate validator handles cross-file rules.                                           |
| Protocol details live in a nested `oidc` / `oauth2` block | New protocols add a block instead of restructuring committed files                                                        |
| `slug` is the identity                                    | User schemas and flow definitions reference connections by slug, so revisions never invalidate references                 |
| Revisioned on the server                                  | In-flight attempts, rollback, and audit need immutable revisions. The CLI syncer is the `mutable` kind, not `revisioned`: the server mints each revision under a unique connection id ([area 4](4-cli-provider-setup.md#preview-and-apply)) |
| `claim_mapping`                                           | Driven by properties in a tenant-defined user schema; mapping is data, not code.                                          |
| Environment Secrets                                       | The secret values are not configured in the connection file. How the value reaches a deployed engine is an open question; with environments ([#534](https://github.com/zitadel/nextgen/issues/534)) it blocks provider sign-in outside development ([Secrets and Environments](#secrets-and-environments)) |
| Vendor Configurations                                    | Vendor differences are treated as data, not hardcoded branches; see [Vendor knowledge is data](#vendor-knowledge-is-data) |

## Vendor knowledge is data

### Context
zitadel/zitadel implements each vendor as a Go package, and most of that code is configuration written in Go: issuers, endpoints, forced scopes, claim mappings. Across its six vendors only three things are behaviour rather than data: GitHub fetches `/user/emails` when the profile email is private and keeps the `primary && verified` address; Apple signs its own client secret (an ES256 JWT with a one-hour expiry, so an implementation caches and refreshes); Apple uses `response_mode=form_post`, which turns the callback into a POST.

### Proposal
So the proposal is: **configuration for everything data-shaped, named strategies for the rest.**

Some providers require custom actions during sign-in, which we call **strategies**. 
The server implements the logic for each strategy once and stores it in a **registry**, 
a mapping of unique names to their specific implementations and contracts. 
A connection activates one of these extra steps simply by referencing its registry name 
(e.g., "supplementary_fetch": "github_primary_email"). 
While standard configuration fields handle static data, 
only a named strategy can introduce new execution steps. 
If a connection doesn't select a strategy, it defaults to the standard protocol flow.

While this mechanism is built for general use, 
Epic 851 introduces just `supplementary_fetch` to support GitHub.
Currently, `github_primary_email` is its only entry, as GitHub is the only provider in this release requiring a custom action. 
Google’s setup, by contrast, is entirely data-driven. 
When Apple is integrated later, its signed secret will introduce a second slot (`secret_strategy`).

**Two rules keep this mechanism predictable:**

**Registry entries carry strict contracts:** 
A strategy declares its protocols, required scopes, emitted claims, and verified properties. 
For instance, `github_primary_email` requires `oauth2` and `user:email`, while emitting/verifying email.
The JSON schema enforces the name, protocol, and scope parts of these contracts via closed enums and conditional checks, 
causing typos or unshipped strategies to fail at validation; the verified-properties part is a validator rule. Adding a new strategy is a non-breaking change.

**Strategies are the definitive authority:** If selected, a strategy always runs and replaces same-named claims from userinfo or the `id_token`, so `verified_claims: {"email": "$supplementary_fetch"}` always resolves, at the cost of one request per login.

## Example

Setup scaffolds one file per selected provider: [`google.json`](schemas/google.json) (OIDC, discovery supplies the endpoints) and [`github.json`](schemas/github.json) (OAuth2, no discovery, endpoints explicit). Both store env var references, never secret values, and both carry a `claim_mapping` generated from the active user schema.

## The connection schema

The full draft: [`schemas/idp-connection.json`](schemas/idp-connection.json).
How to read the schema:

- **Root vs. Protocol Blocks:** The root level defines universal requirements: identity (`slug`, `protocol`, `template`, `display_name`), resolution (`subject_claim`, `claim_mapping`, `verified_claims`), and trust (`provisioning`). Protocol-specific plumbing is isolated inside nested blocks.
- **Protocol Selection:** The `protocol` field dictates the active block. Using `if protocol == "oidc"` requires the `oidc` block and explicitly forbids `oauth2`.
- **Precise Error Messages:** The schema uses `if`/`then` conditionals rather than `oneOf`. While `oneOf` throws generic "all arms failed" errors, `if`/`then` pinpoints the exact issue (e.g., `/oidc must have required property 'client_id'`).
- **Intentional Duplication:** The two protocol blocks duplicate ten shared fields. Factoring them out would require `unevaluatedProperties`, which many third-party validators do not support. Since a connection file only ever contains one block, this duplication is safer and more compatible.
- **Scope Enforcement:** In the OIDC block, `scopes` must contain `openid` (enforced via `required` and `contains`, as JSON Schema `default` values do not inject data). Without `openid`, it is not a valid OIDC connection.
- **Subject Claims:** The `subject_claim` field is optional for OIDC (the spec guarantees `sub`, though overrides exist for pairwise IDs like Entra) but strictly required for OAuth2.
- **Strict Secrets:** Literal secrets cannot be committed. Because the schema objects are strict and no `client_secret` property exists, pasting a raw secret triggers an immediate validation error.
- **Editor and UI Affordances:** The `format: "uri"` rule is just an annotation for editor linting (per Draft 2020-12), and `template` is simply a UI rendering hint (for logos and brand colors). Neither reaches the core engine.
- **TLS Required:** Every endpoint URL (`issuer`, `jwks_uri`, and the endpoints in both blocks) carries a `pattern` requiring `https://`, with one carve-out for local development (`http://localhost` and `http://127.0.0.1`). OIDC requires TLS on these endpoints, and every one of them handles codes, tokens, or key material; `format: "uri"` alone would enforce nothing. The carve-out is exactly those two spellings; `http://[::1]` does not match, so IPv6 loopback setups must use `localhost`.
- **Future-Proof Terminology:** "Claim" is used as a protocol-neutral term for any provider assertion (whether OIDC claims, OAuth2 userinfo, or future SAML attributes), ensuring root field names remain stable as new protocols are added.

### Provisioning

`creation` names what the engine does with an unknown subject. zitadel/zitadel expresses the same thing as two booleans ([`oidc/oidc.go#L41-L60`](https://github.com/zitadel/zitadel/blob/632a5196800c5919e5043d482846ec59d7fad88e/internal/idp/providers/oidc/oidc.go#L41-L60) `WithCreationAllowed` / `WithAutoCreation`), four states behind two bits. This design names the states instead.

| `creation` | Legacy bits | Unknown subject |
| :--- | :--- | :--- |
| `disabled` | allowed=false, auto=false | `identity_unknown` routes to an authored error step. The provider signs in existing users only. |
| `auto` (default) | allowed=true, auto=true | Claims cover every required property: the user is created without a form. Otherwise the collection step, prefilled with what arrived. The epic's new-user journey. |

Two further states exist behind the bits; neither ships in 851:

- `auto_only` (allowed=false, auto=true): complete claims create the user, incomplete ones fail closed at an error step. The "trust the provider, no user input" mode of zitadel/zitadel#8420. Returns as an additive enum value once the engine has the fail-closed branch; when `x-verify` returns, an unverified identifier property fails closed here and drops to collection under `auto`, so that rule needs no further field.
- `collect` (allowed=true, auto=false), always the collection step, is not planned. Wanting the user to stop means wanting a property from them, and a required property the provider cannot supply already forces collection under `auto`. Editing prefilled verified values only drops their verification.

Neither shipped value enforces verification in 851; that arrives with `x-verify`. The complete logic is under the [resolution branches](3-social-login-flow.md#resolution-branches) in area 3.

**A ceiling, not a policy.** The connection states how far this provider's data is trusted, which varies by provider. Whether a given user type may sign up at all is a property of the user type, owned by authentication method settings ([#898](https://github.com/zitadel/nextgen/issues/898)). That policy may narrow the connection's value (a Google connection at `auto` serving Customers at `auto` and Employees at `disabled`), never widen it; the effective rule is the intersection, as #898 states. The connection is the only layer that exists in 851. Recorded under [Product decisions](README.md#product-decisions).

### Deferred and Cut Fields

Several fields have been intentionally excluded from the initial schema based on a strict rule: **nothing is selectable without a backing implementation**. When these features are eventually built, they will be reintroduced as additive, non-breaking changes.

| Deferred Field | Return Condition / Status                                                                                                                                                                                                                                       |
| :--- |:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `secret_strategy` & `secret_params` | When Apple integration is scoped (required for Apple's signed secret).                                                                                                                                                                                          |
| `response_mode` (`form_post`) | When Apple is scoped (the current 851 callback supports GET only).                                                                                                                                                                                              |
| `dynamic_authorize_parameters` | Once a design exists for sourcing runtime values in the authorize URL.                                                                                                                                                                                          |
| `is_linking_allowed`, `auto_linking` | When the deferred account-linking journey is designed and implemented.                                                                                                                                                                              |
| `creation: auto_only` | When the engine has the fail-closed branch for incomplete claims ([Provisioning](#provisioning)). Additive enum value. |
| `is_auto_update` | When per-property verification state exists (the `x-verify` return). Until then the engine could only treat it as `false`, a committed no-op whose behavior would later change under tenants. Its exported contract stands: never silently overwrite a verified property with an unverified value. |
| `enabled` | **Not planned.** An unlisted connection is already inert. Furthermore, a config flag is a poor mechanism for an emergency disable (due to release latency, and rollbacks would inadvertently re-enable it). Imperative runtime disabling remains an open point. |
| `kind`, `audience`, `default_schema` | **Cut completely.** No identified use case or need.                                                                                                                                                                                                             |

- **No `audience`:** Connections are referenced by slug and gated by the schema's provider list; a second scoping axis would conflict with that.
- **No `default_schema`:** The flow pins the schema, and one connection serves many.

## Claim Mapping

The `claim_mapping` block translates the tenant's internal property names (keys) into the external provider's claim names (values):

```jsonc
"claim_mapping": { "email": "email", "givenName": "name", "employeeId": "login" }
```

- **Multi-Schema Support:** A single connection can serve multiple schemas. Each schema simply filters the mapping, consuming only the properties it defines and safely ignoring the rest.
- **Seeded, then owned:** The CLI seeds `claim_mapping` once at scaffold by intersecting the catalog claim table with the active schema's property names, so a scaffolded file never starts with unknown targets. Matching is by name: a property gets a row only when the table has one for that name. For any other property the tenant adds a row by hand, mapping their property name to the claim name in the provider's documentation. The block is tenant-owned after that; re-running the journey extends it and never rewrites existing rows.
- **Known Limitation:** If two schemas use the exact same property name but need it populated from different provider claims, they cannot share a connection. The workaround is to create a second connection with a distinct `slug`.
- **No Annotation Conflicts:** The currently unused `x-claim` annotation on user properties dictates what claim Zitadel emits, meaning it does not conflict with this incoming connection mapping.
- **Catalog Data Caveat:** GitHub exposes no given/family name split; its `name` claim is the full display name. The catalog claim table still maps `givenName: "name"` as the pragmatic default, which puts a full name into `givenName`. Tenants wanting precise name semantics drop that mapping and let the collection step ask. `familyName` has no GitHub source and is never mapped.
- **Validation vs. Runtime Safety:** Unknown-target checks run at plan, against every referencing schema; the CLI reads the working tree, and the server checks at flow create and update, since schema revisions have no stable lineage. At runtime the flow's pinned schema revision filters the mapping; unmatched keys are ignored. A connection create or revise triggers no server-side pair check: the CLI re-lints every pair on any working-tree change, and for hand-authored API writes the runtime filter is the safety net, so their warnings lag until the next plan or flow write.

The `verified_claims` field is the companion map for verification state, offering three value forms:

| Value | Meaning | Exists because |
| :--- | :--- | :--- |
| `"email_verified"` | Read this claim. | OIDC providers assert verification in a specific claim. |
| `true` | Trust this provider unconditionally. | Entra-style stated trust requires it. |
| `"$supplementary_fetch"` | The selected fetch strategy verifies it. | GitHub verification relies on a `primary && verified` fetch result, not a single claim. |

A `$`-prefixed value acts as a pointer to the strategy field of the same name 
in the protocol block. For instance, `"$supplementary_fetch"` defers to whatever 
the `supplementary_fetch` field selects. The strategy's backend contract (its server-side definition) must formally declare that it knows how to verify that specific property. If you write a pointer without selecting a strategy, or map it to a property the strategy cannot verify, you will get a validator error.

All `$` values are reserved. Only `$supplementary_fetch` exists, so any other `$` string is a schema error. A typo in a plain claim name fails silently (claim names are provider-controlled and unchecked at plan time); a typo in a `$` value fails hard. One slip stays out of reach: the string `"true"` is a claim name, not the boolean, so it sends the engine looking for a claim named `true` and fails closed. The validator warns on the literal strings `"true"` and `"false"` here.

The list of allowable pointers will grow only when a new claim-verifying strategy *slot* is added, requiring just one `const` per slot, making it a non-breaking change. Introducing new strategies to an existing slot requires no schema changes, because the pointer references the field name, not the specific strategy.

## Linking Safety

Epic 851 does not include account linking. The linking fields are excluded from the schema, and the engine currently has no linking path. This section records the analysis that future linking implementations must inherit to avoid security flaws:

- **Email linking requires verified claims:** Auto-linking accounts based on unverified emails is an account takeover risk. OAuth2 `userinfo` lacks verification semantics, and some OIDC providers allow tenant admins to set arbitrary emails (such as the nOAuth attack against Entra). Therefore, auto-linking by email must strictly require verified-email coverage.
- **Linking rules are cross-resource:** Tenants author their own property names. Which property acts as "the email" is defined by the referencing schemas' annotations, not by the connection. This means the linking rule belongs in the validator and the engine, rather than the connection schema. Hardcoding a check for the literal name `email` in the connection schema would break for any tenant who names their property `emailAddress`.
- **Username matching limitations:** Username matching has no verification equivalent. Subject-based matching is the only strongly secure variant.
- **Subject matching is not schema-aware:** A single connection can serve several schemas, so one person's Google account can legitimately back both a Customers user and an Employees user. The link key `(connection, subject)` carries no schema, a user row carries exactly one (`users.schema_url`, `internal/storage/dialect/postgres/migration/sql/000004_users.sql:5`), and a flow definition names exactly one (`user_schema`, `api/openapi/components/flows/flow-definition.yaml:26`). A subject lookup can therefore return a record the active flow's schema does not own. Linking must settle whether identity spaces are per schema or per project before it can match on subject at all; the open question lives in [area 3](3-social-login-flow.md#open-points).

The `verified_claims` field itself stays in the 851 schema. Its 851 reader is diagnostics: the callback evaluates each entry into the resolved identity's verification results, which the server log carries. Gating creation on those results and persisting them on the user both return with `x-verify`, as does the deferred `is_auto_update`. Keeping the field now means the committed connection shape does not change when they do.

**The `x-verify` Dependency:**
`x-verify` no longer exists in the dialect. [#901](https://github.com/zitadel/nextgen/pull/901) removed it (together with `x-editable`, `x-sensitive`, and `x-mfa`) because nothing read it, stating the removed annotations "can be re-added once they become required". [`user-property.json`](../../../packages/config/meta-schemas/user-property.json) today carries only `x-unique`, `x-claim`, and `x-audit`. This design is the first consumer: every `x-verify` reference in these documents describes the returning annotation, not the shipped dialect.

The annotation returns with the engine work that first reads it. The step 5 gate evaluation ([area 3](3-social-login-flow.md#callback-processing)) needs only the annotation and the attempt. Recording the result at creation, the `is_auto_update` downgrade guard, and dropping verification on edit also need per-property state tracking, which does not exist either (`user_attributes` stores bare key/value pairs). On return, the free-form `string` value should tighten to an enum of implemented methods, per the same nothing-without-implementation rule that governs [deferred and cut fields](#deferred-and-cut-fields). The two validator rules below that pair `verified_claims` with `x-verify` activate when it returns. That dependency is why `is_auto_update` itself is deferred rather than shipped as a settable no-op (see [deferred and cut fields](#deferred-and-cut-fields)).

## Validator Rules

These are cross-file and state-dependent rules that a single-file JSON schema cannot express. They are implemented in two places: the TypeScript CLI validator (which reads the working tree and CLI state during the validation phase) and the Go server (which mirrors the rules where it has the inputs; its schema-connection share is enforced when flows are created or updated, as detailed in the [validation rules](2-auth-method-selection.md#validation-rules)). The checks comparing `claim_mapping` and `verified_claims` against schemas are provisional (see [Open points](#open-points)).

| Rule / Constraint | Severity | Description                                                                                                                                                                                                             |
| :--- | :--- |:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Slug Uniqueness** | Error | `slug` must be unique across all `.zitadel/idps/` files.                                                                                                                                                                |
| **Slug Modification** | Error | Cannot change the `slug` on a state-tracked file. A true rename requires creating a new one (see [Lifecycle](#connection-lifecycle)).                                                                                              |
| **Identity-Critical Revision** | Error | An identity field changed on a state-tracked connection: `protocol`, `subject_claim`, `issuer`, `jwks_uri`, `token_endpoint`, or `userinfo_endpoint`. Identity links key on the connection id, so the edit would hand existing accounts to whoever holds the same subjects at the new authority. Like slug, these fields are fixed for the life of a connection; a real change is a new connection (see [Lifecycle](#connection-lifecycle)). The check reads local state, which a fresh clone lacks; the server's refusal on revise is the authoritative one. |
| **File Move** | *Handled* | An orphaned state entry paired with a new file using the same `slug` is treated as a file move. State is rekeyed, and the platform is not touched.                                                                      |
| **Orphaned Mapping Target** | Error | A `claim_mapping` target is unknown to *every* referencing schema (assumes at least one schema references the connection). This typically indicates a typo.                                                             |
| **Missing Mapping Target** | Warning | A `claim_mapping` target is missing from *some* referencing schemas. This is permitted because a connection can legitimately map a superset of fields.                                                                  |
| **Orphaned Verification Key** | Error | A `verified_claims` key is unknown to *every* referencing schema. A typo here means the claim will silently never verify.                                                                                               |
| **Unreferenced Typo Guard** | Warning | The connection is not referenced by any schema, and a mapping target or verification key is unknown to *every* schema in the working tree.                                                                              |
| **Missing `x-verify` Method** | Warning | A `verified_claims` key points to a property that lacks an `x-verify` method (verification with nowhere to land). Activates when `x-verify` returns (see the dependency note under [Linking Safety](#linking-safety)).                                                                                                       |
| **Invalid Strategy Pointer** | Error | `"$supplementary_fetch"` is used without selecting a strategy, or the selected strategy's contract does not verify that specific property.                                                                              |
| **Inert Connection** | Warning | The connection is referenced by zero schemas. No flow can offer it, making it completely inert.                                                                                                                         |
| **Impossible Registration** | Warning | A flow registration step offers this provider, but `creation` is `disabled`. The user will never be able to successfully sign up. With `disabled`, `identity_unknown` must route to an error step; with `auto`, to a collection step.                                                                               |
| **Impossible Auto-Creation (Data)** | Warning | `creation` is `auto`, but a referencing schema requires a property that the `claim_mapping` does not target. Every sign-in will stop to collect the missing data.                                               |
| **Impossible Auto-Creation (Verification)**| Warning | `creation` is `auto`, but a referencing schema requires an `x-verify` property that lacks a `verified_claims` entry. Absent entries evaluate as unverified, meaning the auto-creation condition can never pass. Activates when `x-verify` returns. |
| **Missing Env Vars** | Error / Warning | Referenced environment variables are missing from the local environment. Interactive journeys and test preflight raise `E_CREDENTIAL_MISSING` as an error (the developer is present to fix it). Batch `plan` only warns, so one IdP file cannot force secrets into every CI pipeline; the authoritative presence check is the server's, at deploy time (see [Upstream Security Pushback](#upstream-security-pushback)). Shipped `assertEnvRefs` hard-fails `plan` for schemas and flows today, so the batch relaxation is a deliberate change. |
| **Literal Secret** | Error | A hardcoded `client_secret` is present (returns a friendly error message, though the schema strictly rejects it anyway).                                                                                                |
| **Leaked Secret** | Warning | A secret-shaped key is found inside `static_authorize_parameters`. This value would be committed to source control and appended to the public authorize URL. Warning, not Error, because the detection is heuristic; the definite cases already error (`client_secret` via Literal Secret, engine-owned keys via Reserved Authorize Parameter). |
| **Reserved Authorize Parameter** | Error | A `static_authorize_parameters` key names an engine-owned protocol parameter (`client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `nonce`, `code_challenge`, `code_challenge_method`). The engine composes these itself; a config override of `state` or `nonce` would silently defeat CSRF and token binding. The schema's `propertyNames` already rejects the keys; this rule restates the failure with a friendly message (like Literal Secret). |
| **Cleartext Endpoint** | Error | An endpoint URL (`issuer`, `jwks_uri`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`) is not `https://`. The schema `pattern` already rejects it, with a `http://localhost` / `http://127.0.0.1` carve-out for local development; this rule restates the failure with a friendly message. |

## Immutability and Revisions

Editing a connection publishes a new, immutable revision rather than modifying it in place. The previous revision continues to exist. This design serves three critical purposes:

- **Stable Auth Attempts:** An SSO attempt spans an external redirect. Configuration is read when building the authorize URL and again minutes later during the code exchange. To prevent mid-flight changes, an attempt binds to a specific revision when it starts and finishes on that exact same revision.
- **Reliable Rollbacks:** A release inherently pins a specific revision of every resource (per ADR 035). If connections were mutable, there would be no static state to pin for a rollback.
- **Built-in Auditing:** Immutable revisions provide a free audit trail (e.g., tracking exactly who changed a client ID, and when).

*Note:* Rotating a secret does not create a new revision because the configuration file only stores the environment variable name, not the secret's value. (Flow definitions are transitioning to this same revisioned model in [#530](https://github.com/zitadel/nextgen/issues/530)).

## Referencing by Slug

Upstream resources, such as schemas (`x-auth-methods.sso.providers`) and flow steps (`sso_providers[].id`), always reference connections by their `slug` (e.g., `google`), never by their revision ID.

- **No cascade:** A new connection revision means a new revision id; references by slug mean no schema or flow has to move.
- **Restoring Determinism:** The trade-off of referencing a slug is late binding (the name `google` does not explicitly state which revision should run). To maintain strict determinism, two exported mechanisms handle resolution:
  1. The auth attempt binds the current revision at the exact moment it starts.
  2. The release bundle securely records which revision each slug resolved to at the time of construction.

## Connection Lifecycle

- **Slugs cannot be renamed in place:** In-flight attempts, deployed releases, and identity links bind to the name, so the validator refuses the edit. Create a new connection with the new slug, update the references, and retire the old one on its own schedule.
- **Renaming a file is a move:** State is keyed by file path, so a `git mv` would look like a delete and a create. The planner pairs an orphaned state entry with the new file carrying the same slug and rekeys without touching the platform; slugs are unique, so the pairing is unambiguous. Renaming the file and changing the slug at once is a delete and a create.
- **Deletion:** Open, decided with the CRUD API; it must not break a live flow ([Open Points](#open-points)).
- **Identity links key on the connection id:** Users created through a provider hold identity links tied directly to the connection's unique ID. To guarantee these links survive safe edits and are never inherited by unrelated connections, the CRUD API enforces strict mutation rules:
    - **Stable IDs:** A unique connection ID is minted at creation and shared across every revision, ensuring edits never orphan existing links.
    - **Slug Reuse:** If a connection is deleted and its slug is reused, the new connection receives a brand new ID, protecting the old links. *(Note: Whether a retired slug remains permanently reserved to prevent schema and flow references from resolving to the new connection is an open question tied to the deletion design).*
    - **Immutable Authority Fields:** Changing *who* answers for a subject (e.g., the `issuer` or `subject_claim`) while keeping the same connection ID would cause silent account takeover: subject `12345` at a new issuer would inherit the account of subject `12345` from the old one. Therefore, these fields are fixed for life. The validator and server will explicitly refuse such edits as an **Identity-Critical Revision**.
    - **Authority Migrations:** A true authority change requires creating a new connection with a new ID, and users must sign up again under it. Preserving links across an authority change is not included in this design.

**What a revision may change**
A connection's core identity is defined by its slug, its authority, and its subject rule. Everything else forms the mutable revision body.

| Fields | On a state-tracked connection |
| :--- | :--- |
| `slug` | **Fixed.** A rename requires creating a new connection ([Slug Modification](#validator-rules)). |
| `protocol`, `subject_claim`, `issuer`, `jwks_uri`, `token_endpoint`, `userinfo_endpoint` | **Fixed.** These define *who* a subject is; altering them requires a new connection ([Identity-Critical Revision](#validator-rules)). |
| `client_id`, `client_secret_env`, `scopes`, `static_authorize_parameters`, `token_endpoint_auth_method`, `authorization_endpoint`, `supplementary_fetch`, `claim_mapping`, `verified_claims`, `provisioning`, `display_name`, `template` | **New revision.** Safely mutates the configuration. <br><br>*(Note: Generating a new OAuth app/`client_id` at the same authority safely retains the subjects because Google's `sub` and GitHub's `id` are global to the user account. Providers issuing pairwise subjects, computed per sector, so a new app under a different redirect host gets new subjects, turn this into orphaned links and duplicate users; that is a custom-provider question).* |
## Secrets and Environments

**What is currently implemented:** The file convention. Files store variable names (e.g., `client_secret_env`), and literal secrets fail validation. Scaffolding automatically gitignores `.env*` files, error messages only expose variable names, and file bodies are uploaded verbatim.

**What is missing:** Everything after the file upload. There is currently no secret store, resolution step, or rotation path designed. The nearest specification, [`configuration-surface.md`](../platform/configuration-surface.md), explicitly defers the secret-store design.

This document outlines the strict constraints that any future secret lifecycle design must satisfy:

| Ruled Out Approach | Reason |
| :--- | :--- |
| **Client-side resolution** (uploading the resolved value in the document) | Every immutable revision would permanently embed the secret. Leaks could never be scrubbed, rollbacks would reactivate revoked secrets, and plan diffs would expose secret material in Git and CI logs. |
| **Server-side OS resolution** (server reads from its own environment) | This only works for self-hosted setups. In a multi-tenant system, operators would be forced to inject every tenant's secrets into the core engine configuration. |

**The Surviving Pattern:** The configuration file stores the variable name, the value is delivered out of band, and the engine joins them at runtime. This allows secrets to be rotated via a store write without publishing a new config revision, and it keeps values safely outside the release boundary. The store and its API are undesigned, so this stays an open question, not a decision.

**Strict Invariant:** Secret resolution must never happen upstream of anything that is diffed, hashed, committed, or printed.

### Open Challenges

- **Rotation:** Rotation is a critical emergency path. Because the engine currently hashes the file to detect changes, a "rotate-then-apply" action would silently skip execution ("no change") during an incident. The final design needs a mechanism to positively confirm that the engine holds the new secret value.
- **Per-environment non-secrets:** Values like `client_id` differ between environments (e.g., dev vs. prod). While `${VAR}` syntax exists, resolution does not. Because a release deploys the exact same file revision to every environment, these variables cannot be resolved directly into the file. The reference must reach the engine and resolve against the environment there. To support single-environment projects natively, the configuration field accepts either a literal string or `${VAR}` syntax without requiring a separate `client_id_env` field.

### Upstream Security Pushback

Before the deferred secret-store specification is finalized, the following architectural constraints must be addressed:

- **Write-only production stores:** The proposed "read-back" store (where teammates can fetch per-environment secrets) is an anti-pattern. A read-back model means one compromised project credential exposes every provider secret across all environments. Production values must be writable by the deployment identity, readable exclusively by the engine, and never fetchable by local developer setups.
- **Scoping the presence check:** Requiring secret validation before a plan runs means a single IdP file in the repository will force every CI pipeline to demand secrets, even for unrelated PRs. The plan phase should only issue warnings. Strict presence checks should be answered by the server during actual create or update deployments. The validator rules adopt this split: `E_CREDENTIAL_MISSING` stays an error inside interactive journeys and test preflight, batch `plan` warns, and the server answers the strict check at deploy.
- **Encryption minimums:** Stating "encrypted at rest" is insufficient. The architecture must guarantee per-tenant envelope keys, engine-only decryption, and a strictly write-only external API surface.

## Forward Compatibility

Connection files are committed to version control and entirely tenant-owned. Therefore, any schema change that invalidates existing files is treated as a required migration, not just a standard release.

| Change Type | Breaking? |
| :--- | :--- |
| Adding an optional property, a new enum value, a new protocol block, or relaxing a requirement. | No |
| Adding a required property, tightening a constraint, or adding new requirements to an existing enum value. | **Yes** |

This is why unimplemented values are excluded: a placeholder that gains requirements later breaks existing files. The receipt suite checks that a future schema with Apple's fields (`secret_strategy`, `secret_params`, `response_mode`) validates every file that passes today.

**Reverse Compatibility:** The reverse direction is intentionally not protected. An older version of the validator will actively reject a newer file containing unknown fields. This is the accepted trade-off required to maintain strict and effective typo-catching.

## Exported Requirements

Behaviors this design relies on but does not implement.

| Requirement | Owed By |
| :--- | :--- |
| A stable `slug` is the connection's identity: user schemas and flow definitions reference connections by slug only, never by revision id. | [`2-auth-method-selection.md`](2-auth-method-selection.md) |
| An SSO attempt must bind to a specific connection revision at the exact moment it starts. | [`3-social-login-flow.md`](3-social-login-flow.md) |
| An absent verification claim must be evaluated as unverified (fail closed). | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine |
| Truthiness evaluation must strictly accept only boolean `true` or string `"true"`. | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine |
| `is_auto_update` must never silently overwrite a verified property with an unverified value. | [`3-social-login-flow.md`](3-social-login-flow.md) / Engine |
| Strict linking coverage rules must be enforced when the feature returns. | Deferred account-linking journey |
| Slug-to-revision resolution must be securely recorded during release-bundle construction. | [#529](https://github.com/zitadel/nextgen/issues/529) bundle constructor |
| The API surface must support `get-by-slug` and strictly enforce uniqueness on creation. | Server CRUD API |
| A unique, revision-stable connection id must be established to safely maintain user identity links. | Server CRUD API + Deletion semantics |
| The identity fields (`protocol`, `subject_claim`, `issuer`, `jwks_uri`, `token_endpoint`, `userinfo_endpoint`) belong to the connection, not the revision: a revise whose body changes one is refused, as a slug change is. Hand-authored API writes bypass the CLI check. | Server CRUD API |
| A resolved client-secret value must be obtainable during the token exchange step. | Deferred secret-store spec (production); the development-runtime env join is [#851](https://github.com/zitadel/nextgen/issues/851) execution work (see [Open Points](#open-points)) |
| The server must validate every connection body against `idp-connection.json` at create and revise, before a revision is stored. Client-side validation does not cover hand-authored API writes (ADR 035 keeps direct CRUD first-class), and revisions are immutable, so a stored literal secret could never be scrubbed. | Server CRUD API |
| The Go server must mirror and enforce all cross-resource validator rules. | Server validator |

## Open Points

- **`scaffoldedFrom` tracking:** An optional string on `ResourceEntry` recording which shipped default generated a file, the merge base for upgrading scaffolded defaults later. Record it now; it cannot be reconstructed afterwards.
- **The secret lifecycle:** The actual mechanics of the secret lifecycle (the store, the set-surface, the engine join, and rotation) are owned by the deferred secret-store specification. This document only contributes the structural constraints and the security pushback outlined in the section above. That ownership covers production. Development cannot wait for the spec: the local runtime inherits only the CLI process environment ([`binary.ts:70`](../../../apps/cli/src/lib/local-server/binary.ts)) or two fixed docker `--env` values ([`docker.ts:35-38`](../../../apps/cli/src/lib/local-server/docker.ts)), so `.env.local` never reaches the engine and no configured provider can complete a token exchange. Wiring the development join is [#851](https://github.com/zitadel/nextgen/issues/851) execution work, under the same never-upstream invariant; area 4 owns it ([Exported Requirements](4-cli-provider-setup.md#exported-requirements)).
- **Imperative runtime disable:** We need a way to imperatively disable an IdP at runtime (e.g., `zitadel idp disable google --env prod`). This mechanism must be per-environment, execute in seconds, and remain immune to config rollbacks. Because of these requirements, it must be specified as part of the runtime surface, never as a configuration field.
- **Deletion semantics:** We must decide between a "refuse-while-pinned" approach (which requires a grace window for in-flight attempts) or a "tombstoning" approach. Decided with the CRUD API design.
- **Deletion must not break a live flow:** Flows and schemas reference a connection by slug, and nothing in the design refuses a delete while a flow references the slug, so a live login page could render a button whose attempt cannot start. Either the delete is refused while a live flow's pinned schema lists the slug (needs the cross-resource reader, scoped to live pins, or nothing is ever deletable), or the engine hides a provider whose slug no longer resolves when it renders the step and the attempt fails closed ([area 3](3-social-login-flow.md#constraints--edge-cases)). Holds under either deletion model.
- **Schema-keyed validation:** The epic requires that one connection can support multiple user schemas, so a connection's `claim_mapping` and `verified_claims` may name properties of several schemas (the superset model). What remains undecided is how strictly those fields can be checked. Example: one Google connection used by Customers (`email`, `firstName`) and Employees (`email`, `department`) maps all three; a misspelt `department` errors only when no referencing schema owns the key and warns when another one could, because a typo and a key meant for another schema look alike. The CLI sees every referencing schema and applies both rules; the server cannot see schema lineage and checks less. A 1:1 rule (one connection per schema) would allow error-grade checks everywhere and would make identity resolution schema-specific by construction, but it contradicts the epic's criterion and duplicates connection config and credentials per schema. The validator rules record the superset status quo.
- **The CRUD API itself:** Currently, no IdP API exists. Building the endpoints, generated client, and handlers represents the largest pending work item in this domain. The surface is now designed; implementation remains.
- **Catalog claims schemas:** Plain claim-name values are provider-controlled and unchecked at plan time. The catalog already carries per-vendor claim tables, and strategy contracts declare their emitted claims, so promoting each template's claim table to a small claims schema would turn a typo'd `claim_mapping` value or `verified_claims` source into a plan-time warning for `google` and `github`, with custom providers keeping today's unchecked behavior. It is also the base for any future typed or expression mapping. Not 851 work.

## Related

- [ADR 007](../../adrs/007-gitops-configuration-surface.md): GitOps configuration surface
- [ADR 035](../../adrs/035-configuration-environments.md): releases and environments
- [ADR 042](../../adrs/042-scaffolded-file-ownership-and-drift-detection.md): scaffolded app-file ownership; extended here by analogy
- [ADR 020](../../adrs/020-credentials-out-of-user-schema.md): `x-auth-methods` as policy input
- [`../cli/identity-surface.md`](../cli/identity-surface.md): earlier draft of this resource
- [`../platform/configuration-surface.md`](../platform/configuration-surface.md): secrets, environments (written before ADR 035 renamed push to deploy)
- `api/openapi/endpoints/schemas/flow-definition.json`: `SSOProvider`, `Gate`
- `apps/cli/src/lib/sync/`: `ResourceSyncer`, state, sync loop
