# Social Login Flow

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 3 of 6 (see [`README.md`](README.md))

This document defines how a user signs up and signs in using external identity providers like Google or GitHub, detailing the OAuth2/OIDC redirect ceremony, identity resolution, and all available recovery paths.

## Imported Requirements

What [`1-resource-model.md`](1-resource-model.md#exported-requirements) and [`2-auth-method-selection.md`](2-auth-method-selection.md) expect this area to answer:

- [x] **Attempt binds a connection revision at attempt-start:** The `state` record carries the exact connection revision ID, and the callback phase strictly reads that pinned revision.
- [ ] **Client secret at token exchange:** Open dependency. The overall secret lifecycle remains undesigned (see [area 1](1-resource-model.md#secrets-and-environments)). The ceremony assumes a valid secret value is obtainable at exchange time.
- [ ] **Linking coverage rule:** Handed off. Epic 851 excludes account linking, and the corresponding policy fields have been omitted from the schema. The security analysis is documented in area 1's [Linking safety](1-resource-model.md#linking-safety) section.
- [x] **Fail closed on missing verification:** An absent verification claim evaluates as unverified.
- [x] **Truthiness evaluation:** Strictly boolean `true` or string `"true"` evaluate as verified; all other values evaluate as unverified.
- [x] **`is_auto_update` protection:** `is_auto_update` consults `verified_claims` to prevent silently overwriting a verified property with an unverified value.

*Pending elsewhere:* Release bundle name-to-revision mappings (ADR 035 amendment), the CRUD API slug surface, and the Go server validator mirror.

## The Ceremony

The end-to-end OAuth2/OIDC redirect ceremony progresses through three main phases:

```
submit { action: "sso", sso_provider_id: "google" }
  engine: reject if provider absent from the step's sso_providers
  engine: mint state record, build authorize URL (PKCE), emit sso-redirect step
browser → provider → user authenticates
provider → GET {issuer}/__nextgen/idp/callback?code=…&state=…
  engine: validate state (single-use), exchange code, map claims, run strategy
  engine: resolve identity → fire outcome on the originating step
frontend: GET /flow/{id} → next step per the authored transitions
```

### Callback URI

The system uses a single fixed route with an identical shape across every environment:

`{environment issuer}/__nextgen/idp/callback`

Because external identity providers require exact-match redirect URIs, the path carries no flow ID. All correlation is handled dynamically via the `state` parameter.

While the shape is finalized, both structural halves depend on pending architecture:

- **Origin Resolution:** The origin relies on the environment's declared issuer (`issuer` / `issuer_pattern`, typed in [`configuration-surface.md`, Environments](../platform/configuration-surface.md#environments); ADR 035 defers per-environment value shape to a follow-up ADR). Environments remain unimplemented: no Go or API types exist. Currently, only the local development origin can be derived (via the dev-port setting). Multi-environment derivation will land under issue [#534](https://github.com/zitadel/nextgen/issues/534) (part of [#529](https://github.com/zitadel/nextgen/issues/529)). Note that pattern environments using `issuer_pattern` can never produce an exact URI, so social sign-in cannot work there; area 2 grades the conflict a warning because exact environments can coexist in the same project, and the error-grade check is deploying a social-login flow to a pattern environment, which lands with #534's environment persistence.
- **Server Routing:** The route does not exist yet. The `/__nextgen` path serves as a client-side proxy prefix, but the server currently mounts no handlers under it. The callback requires the proxy to forward the path and a dedicated server route to receive it, alongside any necessary prefix-rewriting logic.

### The `state` Record

The `state` record serves as the server-side, single-use anchor for the attempt:

| Field | Purpose |
| :--- | :--- |
| **Flow / Attempt ID** | Provides correlation, serving as the sole link from the callback back to the active ceremony. |
| **Provider Slug + Connection Revision ID** | Enforces revision binding at attempt-start, ensuring the callback phase never re-resolves the slug. |
| **Browser Binding Nonce** | A `__Host-` cookie nonce set during the `sso-redirect` step. The callback must originate from the browser that initiated the ceremony to prevent login CSRF attacks (where an attacker completes their own ceremony inside a victim's browser). The attributes are part of the contract: the `__Host-` prefix requires `Secure` and `Path=/` and forbids `Domain`; `HttpOnly` must be set explicitly (the prefix does not imply it), and it must be `SameSite=Lax` because the callback arrives as a cross-site top-level GET; `Strict` would drop the cookie on exactly that navigation and fail every ceremony (the shipped `_zflow` cookie is `Strict`, so its settings cannot be copied). `Secure` on `http://localhost` works in Chrome and Firefox but not every engine, so the dev loop needs per-browser verification. |
| **PKCE Verifier** | Present when the connection enables PKCE (`pkce_enabled`, the default); the challenge is always `S256` when sent. A connection may set `pkce_enabled: false` only for a provider whose token endpoint rejects the parameters (area 1); binding then rests on `state` and, for OIDC, `nonce`. |
| **OIDC `nonce`** | Echoed in the `id_token` to bind the issued token strictly to this authorize request. |
| **Expiry** | Sets a bounded time window for the external leg, inheriting the attempt's overall TTL. |
| **Return Target** | The browser destination after callback processing, captured at submission time and validated against the environment's declared issuer origin. Never read from callback input: an attacker-supplied target is an open redirect. |

> **Security Note:** A guessable or reusable `state` parameter introduces classic OAuth CSRF and code-injection vulnerabilities. The simplified `state=sess_2_google` placeholder shown in `flow-engine.md` (example 4) must never ship to production. Production `state` values are minted from a CSPRNG with at least 128 bits of entropy, and the PKCE challenge method is `S256`.

The engine owns the protocol parameters of the authorize request: `client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `nonce`, `code_challenge`, and `code_challenge_method`. It composes them itself on every attempt. `static_authorize_parameters` cannot carry these keys (the connection schema rejects them; validator rule "Reserved Authorize Parameter" in [area 1](1-resource-model.md#validator-rules)), and if a reserved key reaches the engine anyway it drops the configured value and keeps its own.

## Callback Processing

The callback phase executes six sequential steps in order, failing closed on error:

1. **State:** An unknown, expired, or already-consumed `state` parameter triggers a flow-level error with a restart route (bypassing step transitions, as the originating flow session may no longer exist).
2. **Code Exchange:** Performed at the connection's token endpoint and authenticated per `token_endpoint_auth_method`. *(Note: Resolving the secret value remains an open dependency).*
3. **ID Token Validation (OIDC):** Verifies the signature using keys from discovery metadata or the connection's `jwks_uri` (failing if neither yields keys). Only asymmetric algorithms from a fixed allowlist are accepted; `none` and the HMAC family are rejected outright (an HS256 token is signed with the client secret, a classic downgrade path). Validates `iss`, `aud` (client ID, checking `azp` when multiple audiences are present), `exp` with bounded clock skew, and `nonce` from the state record. This runtime check enforces that a `jwks_uri` is required when discovery documents are absent, which the schema cannot express.
4. **Claims Extraction:** Extracted from `id_token` when `id_token_mapping` is set; otherwise from `userinfo`. For OIDC, a `userinfo` response whose `sub` does not exactly match the id_token `sub` fails the attempt (OIDC Core 5.3.2); without that check, a provider mixup could attach another subject's claims. Any configured `supplementary_fetch` always runs and overwrites same-named claims from either source (see [area 1](1-resource-model.md#vendor-knowledge-is-data)).
5. **Verification Evaluation:** Applies `verified_claims` rules to determine claim trust:
    - **Claim Lookup:** Strictly boolean `true` or string `"true"` evaluates as verified. Any other value, including a missing claim, evaluates as unverified.
    - **Literal `true`:** Inherently trusts the provider.
    - **`"$supplementary_fetch"`:** Takes the strategy execution result for this attempt.
6. **Identity Resolution:** Looks up `(connection, external_subject)` where the stored subject is strictly a string:
    - **Numeric Coercion:** JSON numbers explicitly coerce to their exact decimal string (e.g., GitHub numeric IDs) to prevent duplicate identities like `12345` vs `"12345"`. The decode must preserve the raw token (`json.Number`), never pass through float64: the legacy mapper's `FormatFloat` path ([`oauth/mapper.go#L35-L47`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/idp/providers/oauth/mapper.go#L35-L47)) rounds ids above 2^53, and two distinct subjects that round to the same string would merge into one account.
    - **Rejection Criteria:** Absent, `null`, empty, boolean, object, or array subjects immediately reject the attempt.
    - **Connection Keying:** The `connection` half of the key requires a revision-stable identity (an open item exported to the CRUD API).

> **Porting note:** Steps 3 and 5 do not fall out of the `zitadel/zitadel` providers. Each has to be added on top:
>
> * **Signing algorithms (step 3):** `rp.NewRelyingPartyOIDC` takes the accepted algorithms from the provider's own discovery document ([`relying_party.go#L264`](https://github.com/zitadel/oidc/blob/v3.47.5/pkg/client/rp/relying_party.go#L264)), leaving the set under provider control. The fixed asymmetric allowlist is what closes the HS256 downgrade path.
> * **Nonce (step 3):** `BeginAuth` sends no `nonce` ([`oidc.go#L143-L166`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/idp/providers/oidc/oidc.go#L143-L166)). The `nonce` carried in the state record is what binds the `id_token` to one authorize request, so the engine must mint and echo it.
> * **Truthiness (step 5):** the `zitadel/oidc` `Bool` type rejects an unrecognized claim value as a parse error ([`userinfo.go#L20-L30`](https://github.com/zitadel/oidc/blob/v3.47.5/pkg/oidc/userinfo.go#L20-L30)), failing the whole userinfo decode. The imported fail-closed and truthiness requirements need that one claim to degrade to unverified instead.

### Server-Side Fetch Policy

Every URL the engine fetches for a connection is tenant-authored: the discovery document, `jwks_uri`, the token endpoint, the userinfo endpoint, and any strategy fetch. On shared infrastructure that is a server-side request forgery surface. The guard is not specific to connections: webhooks, actions, and any other tenant URL the engine fetches later need the same one, the way `zitadel/zitadel` centralizes it in one deny list. The egress policy is therefore its own epic ([#928](https://github.com/zitadel/nextgen/issues/928)), which owns the deny mechanics and evaluates an operator-configurable allowlist mode for locked-down installations. This area consumes it as a dependency and carries two constraints into it:

- **Blocking for 851.** The callback processor fetches discovery, JWKS, token, userinfo, and the strategy URL, so SSO cannot ship to shared infrastructure without at least the baseline deny behaviour: resolve the host, reject private, loopback, link-local, and metadata ranges (RFC 1918, `127.0.0.0/8`, `169.254.169.254`, and their IPv6 equivalents), connect to the address that passed the check, and repeat the check on every redirect hop; cap redirect count, response size, and total fetch time; send only the connection's own credentials, never instance-internal headers.
- **Not configurable per connection.** The connection schema carries no egress fields. Operator-level configuration is the epic's question.

Local development instances may relax the loopback rejection so `http://localhost` providers work, matching the schema's TLS carve-out ([area 1](1-resource-model.md#the-connection-schema)).

## Resolution Branches

A single `transitions.callback` cannot route returning users and new users to different locations. Therefore, resolution fires one of three outcomes from the shipped vocabulary. Because this mapping remains consistent across all execution contexts, shared-entry steps work without modification:

| Resolution State | Outcome Fired | Typical Route Target |
| :--- | :--- | :--- |
| **Known subject** | `callback` | **Done** (Authenticated). The engine applies `is_auto_update` with downgrade guards. Identity is pinned strictly to `(connection, subject)`, never claims, preventing profile edits from forking accounts. An auto-update write that would violate `x-unique` is dropped for that property; sign-in proceeds and the skip surfaces in diagnostics as the property name only. Conflict vocabulary stays reserved for unknown subjects. |
| **Unknown subject** | `user_not_found` | **Data collection step** (register flows) or an **offer-register step** (login flows). |
| **Unknown subject with unique-property collision** | `user_already_exists` | **Conflict resolution step**. The engine binds the attempt to the colliding account, so a password or passkey submit on that step authenticates that account (the same binding `register → password` relies on for a typed collision; here the value comes from the mapped claim). The credential must still be correct, so this adds no oracle beyond the enumeration note below. |

### Creation Without Collection (`is_auto_creation`)

When `is_auto_creation: true` is set (the default), the engine **creates the account immediately without pausing for collection** and fires `callback` as a newly authenticated user, provided the mapped claims supply every required property in the schema.

* **Fallback Behavior:** If a required property is missing, execution degrades to `user_not_found` → data collection, prefilled with what did arrive. This is the epic's new-user journey: the user provides only what the provider did not return.
* **Always Collect:** `is_auto_creation: false` routes every new user through the collection step regardless of completeness. `is_creation_allowed: false` routes `user_not_found` to an authored error step instead, preventing dead ends.
* **Static Warnings:** The plan phase warns when a pairing makes the gate statically dead (see [validator rules](1-resource-model.md#validator-rules)).
* **Verification Gating (deferred):** A second condition joins the check when `x-verify` returns to the dialect: every required property carrying `x-verify` must also arrive verified (per Step 5 of Callback Processing), otherwise the attempt degrades to collection. A required `givenName` then needs only a non-empty value, whereas a required `email` with `x-verify` must also arrive verified. `x-verify` was removed as unread ([#901](https://github.com/zitadel/nextgen/pull/901)); this gate is its first consumer, and no schema can carry it today, so 851 cannot enforce verification on either creation path and does not claim to. Enforcement becomes real per schema, when an author marks a property `x-verify`; committed connections do not change. See [Engine Work](#engine-work) and the dependency note in [`1-resource-model.md`](1-resource-model.md#linking-safety).

### Constraints & Edge Cases

- **Cross-Schema Identities:** Known-subject resolution assumes the user belongs to the flow's pinned schema. Resolving an identity arriving through a flow pinned to a *different* schema remains an open question. Until it is settled, 851 fails closed: when the resolved user's schema differs from the flow's pin, the attempt ends in the flow-level error surface (value-free, logged for diagnostics) rather than half-adopting either schema; the open point below owns the real resolution rules.
- **No Auto-Linking in 851:** Linking policy fields are omitted from the current schema. All account-linking semantics are deferred to the dedicated account-linking specification.
- **Validation Rule:** Steps containing `sso_providers` **must** explicitly route all three outcomes (`callback`, `user_not_found`, and `user_already_exists`) to prevent flow dead-ends (validator rule in [`2-auth-method-selection.md`](2-auth-method-selection.md); today only `transitions.callback` is enforced).

## New Users: Prefill and Confirm

The schema author determines which fields the collection step renders, while the engine populates their values at runtime. This separation is necessary because external providers cannot guarantee claim availability for every user (e.g., GitHub's `name` may be `null`, or an `email` may arrive missing) and a single collection step may handle incoming users from multiple identity providers.

### Engine Rules for Prefill & Confirmation

* **Claim Mapping:** The engine prefills step fields using mapped claims configured in `claim_mapping`.
* **Required Fields:** Required schema properties that arrive empty must be manually completed by the user.
* **Optional Fields:** Omitted optional provider claims block nothing and are silently skipped.
* **User Edits:** Prefilled fields remain editable. Per-property editability rules (`x-editable`) were removed from the dialect as unread ([#901](https://github.com/zitadel/nextgen/pull/901)); until the annotation returns with the collection-step implementation, editability is uniform.
* **Verification Loss on Edit:** Editing a prefilled value immediately revokes its verified status. Because the provider only vouches for its own returned data, modified inputs must re-enter the standard verification pipeline (`x-verify`). This prevents users from replacing a verified prefilled email with an arbitrary address while retaining the verified flag.

### Wire Contract Compatibility

**No wire changes are required.** The existing API contract already supports prefilled data delivery:

* `api/openapi/components/flows/field.yaml` defines `value` (*"Pre-filled value (e.g., an identifier carried over from a pivot)"*).
* `FlowField.Value` is already implemented in `internal/domain/flow_field_resolver.go`.

The only new requirement is having the engine populate `FlowField.Value` directly from mapped claims upon a successful SSO callback, acting as a second producer for an existing field.

## The Resolved External Identity

Following a successful callback, the engine holds the **resolved external identity**: an ephemeral object attached directly to the attempt that dies when the attempt completes or expires.

### Payload Structure

- **Coerced subject:** The string-normalized external identifier.
- **Mapped claims:** Profile attributes extracted and mapped from the provider.
- **Verification results:** Per-claim verification status determined during callback evaluation.
- **Connection revision:** The pinned connection revision tied to the attempt.
- **What is absent:** Provider access, refresh, and ID tokens. They exist only inside callback processing and are dropped when it returns; nothing in 851 persists a provider token.

### Consumers

The resolved external identity is read by four key mechanisms:

- **Collection Step Prefill:** Supplies initial values to prefill form fields.
- **Verification Loss Guard:** Enforces the edit-drops-verification rule if prefilled inputs are modified.
- **Submission Collision Check:** Validates property uniqueness before account creation.
- **Atomic Creation (`create_user_with_sso`):** Consumes the payload atomically to provision the user record.

### Open Items & Integration

* **Storage Shape:** Whether this payload lives as explicit fields directly on the attempt record or as a sibling record alongside the `state` store remains an open design point.
* **Account Linking:** The deferred account-linking journey will anchor directly to this resolved external identity object.

## Conflict Resolution Flow

Scoped explicitly by the epic:

> *"The complete account-linking journey can be defined separately. This ticket must provide a safe recovery route without introducing automatic linking or leaving the user at a dead end."*

```
user_already_exists → authored step: "an account with this email already exists"
  → action: sign in → transition with action: "switch" to the login flow
  → user authenticates with existing factors → continues to the app
```

### Navigation Mechanics: `switch` vs. `pivot`

* **Why `switch` is required:** `pivot` pushes the login flow and auto-pops back to the paused conflicted flow on completion, returning the user to the conflict step instead of the application. Conversely, `switch` replaces the current flow without a return path (its documented design covers navigating between peer flows like login ↔ register).
* **Flow Target Resolution:** While `switch` natively targets another flow *definition*, the single-definition default has none. The scaffolded equivalent instead performs an in-definition navigation repurposed to login (see [`4-cli-provider-setup.md`](4-cli-provider-setup.md#flow-architecture-decisions)). The no-return semantics are preserved in both cases, ensuring `pivot` is never used.

### Trigger Points

The `user_already_exists` outcome fires at **two distinct execution points**, and the flow must route both:

1. **Callback Resolution:** Triggered when provider-supplied values collide with an existing user record.
2. **Collection Step Submission:** Triggered when a user edits a prefilled field into a conflicting value (matching standard registration submission semantics).

The authored conflict transition must be explicitly attached to both steps.

> **Enumeration Note:** The conflict step and the `user_already_exists` outcome behind it confirm to the person completing the ceremony that an account with the colliding value exists. This is a recorded trade-off, not an oversight. The shipped default flow already answers registration submissions with `user_already_exists` (`packages/config/defaults/default-login.json:112`), so social sign-in adds no oracle beyond that baseline, and a generic failure instead would leave the account's legitimate owner at exactly the dead end the epic forbids. The probe is also priced higher than form-based enumeration: the attacker must complete a real provider authentication per attempt.

### Identity Lifecycle & Deferred Linking Seam

* **Conflict Boundary Handling:** The verified external identity is **discarded at the conflict boundary**. No user record is created, no email-based linking is attempted, and the user receives a clear explanation without reaching a dead end. Until the linking journey ships, this loop is deterministic: a user clicking "Continue with Google" repeatedly will land on the same conflict step.
* **Seam for Deferred Account Linking:** The deferred journey will attach at the resolved external identity object; nothing else about that journey is designed here. As a consequence, 851 requires the `create_user_with_sso` `on_success` handler, but does **not** implement or require `link_sso`.

## Failures and Recovery

Failures surface directly as errors on the originating step and never trigger a step transition, keeping the outcome vocabulary strictly bounded. Per the epic's security and UX principles, failures provide a clear explanation and recovery route without exposing internal technical details to the end user.

| Failure Scenario | Error Surface | Recovery Mechanism |
| :--- | :--- | :--- |
| **User cancels / provider denies (`access_denied`)** | Originating step with a localized `text_key` error. | The step remains rendered, allowing the user to retry or select another offered authentication method. |
| **Provider configuration error (invalid client, bad scope)** | Originating step with a generic `text_key` error. | Details are written to server logs and the test journey (area 6); tenant-side misconfigurations are hidden from the end user. |
| **State expired, unknown, or reused** | Flow-level error with a restart route. | Restarts the flow entirely, as the originating flow session may no longer exist. |
| **Binding cookie absent or mismatched** | Flow-level error with a restart route. | The callback's `state` is consumed: the authorization code arrived with this request, so the original tab could never complete the ceremony anyway. The user restarts from the flow. |
| **Code exchange / `userinfo` failure** | Originating step with a generic error. | The user can retry; detailed error diagnostics are written to server logs. |
| **Verification shortfall** | Handled via normal resolution branches. | Handled automatically by resolution rules; the user never sees technical errors referencing claims. |

## Rendering

The current rendering architecture has no built-in knowledge of SSO. The `<zl-sso-providers>` references in prior design documents are illustrative examples rather than implemented components. Closing this gap requires updates across five distinct areas:

* **`<zl-sso-providers>` Atom:** Must be created in `packages/components`. It needs to render one button per provider entry, use `template` as a brand/logo hint, and submit `{action: "sso", sso_provider_id}`.
* **Liquid Templates:** All six shipped templates (the five branding designs under `packages/config/defaults/branding/*/login.liquid` and `default.liquid` in the orchestrator) currently contain no SSO markup. Each requires a conditional block (`{% if sso_providers.size > 0 %}`).
* **Provider Icons:** `zl-icon` currently lacks Google and GitHub glyphs, meaning the `template` hint has no matching icon assets to resolve against.
* **Locale Keys:** Translation keys must be added for button labels (e.g., `login.sso.continue_with`), alongside copy for conflict-step and error states.
* **`sso-redirect` Handling:** Because `sso-redirect` is engine-emitted rather than authored, the orchestrator must be updated to recognize steps carrying a `redirect_url` and execute browser navigation accordingly.

## Engine Work

| Feature / Component | Current Implementation State |
| :--- | :--- |
| **`sso` Submission Handling** | Stubbed at `flow_state_machine.go:331` (replaces the `ErrFlowUnsupported` branch). |
| **`state` Record Store & Callback Route** | Unimplemented (nothing exists). |
| **Connection Fetch Egress Policy** | Unimplemented. Owned by [#928](https://github.com/zitadel/nextgen/issues/928) as a blocking dependency of 851 (see [Server-Side Fetch Policy](#server-side-fetch-policy)). |
| **Protocol Engines** | OIDC discovery/code exchange and explicit-endpoint OAuth2 are available in `zitadel/zitadel` ([`oidc`](https://github.com/zitadel/zitadel/tree/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/idp/providers/oidc), [`oauth`](https://github.com/zitadel/zitadel/tree/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/idp/providers/oauth)), but completely absent in `nextgen`. |
| **`github_primary_email` Strategy & Registry** | Design stage only (see reference implementation in [`github/session.go#L46-L112`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/idp/providers/github/session.go#L46-L112)). |
| **`create_user_with_sso` (`on_success`)** | Referenced in documentation; currently unimplemented. |
| **Claims Mapping & Creation Gate** | Design stage only (covers claims-to-properties mapping, the completeness gate, and verification evaluation into diagnostics; verification gating and `is_auto_update` guards wait for `x-verify`). |
| **Per-Property Verification (`x-verify`)** | Unimplemented end to end. [#901](https://github.com/zitadel/nextgen/pull/901) removed the annotation from the dialect as unread; re-adding it lands with this work. `user_attributes` exists as bare key/value pairs without verification flags, blocking creation-time verification tracking, `is_auto_update` downgrade guards, and edit-drops-verification logic. |

## Exported Requirements

| Requirement | Owed By / Target |
| :--- | :--- |
| **Callback URI Surface:** Expose `{origin}/__nextgen/idp/callback` in the setup journey and per environment. | CLI Journey (Area 4) |
| **Flow Scaffolding:** Scaffold `sso_providers` on the entry steps (both, in the shipped shared-entry default) and the conflict step with its login route. | CLI Journey (Area 4) |
| **Callback Route:** Register route under the server HTTP surface; the scaffolded proxy matcher is already prefix-wide (`/__nextgen/:path*`), so no patcher work remains. | Server |
| **Localization Keys:** Export conflict-step copy (the account-exists explanation plus its submit, passkey, and sign-in actions), error copy, and provider button labels as `text_key` entries. | Login UI / Locale Work |
| **UI & Branding Assets:** Add conditional SSO blocks to all five branding `login.liquid` templates and `default.liquid`; add provider glyphs to `zl-icon`. | Branding Defaults / Components |
| **Failure-Details Channel:** Details are written to server logs and the test journey (area 6); tenant-side misconfigurations are hidden from the end user. | Test journey (Area 6) |

## Open Points

* **Cross-Schema Subject Resolution:** Identity links are `(connection, subject)` pairings, which are schema-agnostic, but users belong to specific schemas and flows pin one schema revision. The rule is undecided for a known subject whose user belongs to a schema different from the active flow's pin.
    * *Candidate Rules:* Per-schema identity spaces (requires per-schema uniqueness, which `x-unique` lacks), a global hard-block error, or failing closed until decided.
    * *Ownership & Scope:* Belongs to the identity-link data model (requiring a revision-stable connection identity and schema *lineage* tracking). 851 fails closed ([Constraints & Edge Cases](#constraints--edge-cases)), which is a dead end for the person signing in. Reachable in 851 once a second schema enables the same connection through area 5's Sign-in methods picker. The concrete two-schema case is recorded in area 1's [Linking Safety](1-resource-model.md#linking-safety); the product decision is listed in the [README](README.md#product-decisions).
* **State Storage Shape:** Deciding between storing state fields directly on the attempt versus maintaining a dedicated table. Consumption must be atomic to handle concurrent duplicate callbacks safely (one succeeds while the second receives a reused-state error). `zitadel/zitadel` does not solve this: `SucceedIDPIntent` reads the intent and then pushes the succeeded event with no expected-sequence guard ([`idp_intent.go#L169-L199`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/command/idp_intent.go#L169-L199)), and a pending state carries no TTL, since `maxIdPIntentLifetime` bounds only the succeeded intent token ([`idp_intent_model.go#L51-L56`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/command/idp_intent_model.go#L51-L56)). Because minting is unauthenticated (any visitor on the login page can submit an SSO step), the chosen shape must also make it cheap to bound pending records per flow and rate-limit minting.
* **Multi-Tab Behavior:** Defining rules for parallel SSO submissions initiated from a single flow (whether the last-minted state invalidates prior states or both remain valid until consumed). The binding cookie shares this decision: one named `__Host-` cookie holds a single value per host, so a second tab's ceremony overwrites the first tab's nonce and fails it at callback; per-attempt cookie names versus accepting the overwrite must be settled together with the state rule.
* **`sso-redirect` Step Shape:** Confirming whether `{name, redirect_url}` (sketched in example 4) serves as the official wire contract or if the redirect URL should be folded directly into the submission response payload. The return leg is settled in [The `state` Record](#the-state-record): the record carries the return target and the callback route consumes it, never reading a destination from callback input.

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1: connection schema, exported requirements)
- [`2-auth-method-selection.md`](2-auth-method-selection.md) (area 2: capability/usage split)
- [`../flowengine/flow-engine.md`](../flowengine/flow-engine.md) (example 4, the SSO sketch)
- [`../flowengine/flow-engine-nodes.md`](../flowengine/flow-engine-nodes.md) (step response shape)
- [`../flowengine/capabilities.md`](../flowengine/capabilities.md) (what is stubbed)
- `internal/domain/flow_state_machine.go`, `flow_on_success.go` (the stubs and handlers)
