# Social Login Flow

> **Status:** Planning notes  
> **Area:** 3 of 4 (see [`README.md`](README.md))

This document defines how a user signs up and signs in using external identity
providers like Google or GitHub, detailing the OAuth2/OIDC redirect ceremony,
identity resolution, and all available recovery paths.

## The Ceremony

The end-to-end OAuth2/OIDC redirect ceremony progresses through three main
phases:

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

The system uses a single fixed route with an identical shape across every
environment:

`{environment issuer}/__nextgen/idp/callback`

Because external identity providers require exact-match redirect URIs, the path
carries no flow ID.
All correlation is handled dynamically via the `state` parameter.

While the shape is finalized, both structural halves depend on pending
architecture:

- **Origin Resolution:** The origin is the environment's declared issuer
  ([`configuration-surface.md`, Environments](../platform/configuration-surface.md#environments)).
  Environments are unimplemented; only the development origin is derivable
  today, from the dev-port setting.
  Environments persist under
  [#534](https://github.com/zitadel/nextgen/issues/534) (part of the
  [#529](https://github.com/zitadel/nextgen/issues/529) releases epic); deriving
  a callback origin per environment depends on it.
- **Server Routing:** The route does not exist yet.
  The `/__nextgen` path serves as a client-side proxy prefix, but the server
  currently mounts no handlers under it.
  The callback requires the proxy to forward the path and a dedicated server
  route to receive it, alongside any necessary prefix-rewriting logic.

### The `state` Record

The `state` record serves as the server-side, single-use anchor for the attempt:

| Field | Purpose |
| :--- | :--- |
| **Flow / Attempt ID** | Provides correlation, serving as the sole link from the callback back to the in-flight attempt. |
| **Provider Slug + Connection Revision ID** | Enforces revision binding at attempt-start, ensuring the callback phase never re-resolves the slug. |
| **Browser Binding Nonce** | A `__Host-` cookie nonce set during the `sso-redirect` step. The callback must originate from the browser that initiated the attempt, preventing login CSRF (an attacker completing their own attempt inside a victim's browser). The cookie attributes are part of the contract ([below](#the-binding-cookie)). |
| **PKCE Verifier** | Present when the connection enables PKCE (`pkce_enabled`, the default); the challenge is always `S256` when sent. A connection may set `pkce_enabled: false` only for a provider whose token endpoint rejects the parameters ([area 1](1-resource-model.md#the-connection-schema)); binding then rests on `state` and, for OIDC, `nonce`. |
| **OIDC `nonce`** | Echoed in the `id_token` to bind the issued token strictly to this authorize request. |
| **Expiry** | Sets a bounded time window for the external leg, inheriting the attempt's overall TTL. |
| **Return Target** | The browser destination after callback processing, captured at submission time and validated against the environment's declared issuer origin. Never read from callback input: an attacker-supplied target is an open redirect. |

> **Security Note:** A guessable or reusable `state` parameter introduces
> classic OAuth CSRF and code-injection vulnerabilities.
> The simplified `state=sess_2_google` placeholder shown in `flow-engine.md`
> (example 4) must never ship to production.
> Production `state` values are minted from a CSPRNG with at least 128 bits of
> entropy, and the PKCE challenge method is `S256`.

#### The Binding Cookie

- **`__Host-` prefix:** requires `Secure` and `Path=/` and forbids `Domain`.
- **`HttpOnly`:** set explicitly; the prefix does not imply it.
- **`SameSite=Lax`:** the callback arrives as a cross-site top-level GET.
  `Strict` would drop the cookie on exactly that navigation and fail every
  attempt.
  The shipped `_zflow` cookie is `Strict`, so its settings cannot be copied.
- **Development on `http://`:** Safari rejects `Secure` on `http://localhost`
  (Chrome and Firefox accept it).
  The shipped `_zflow` cookie lets `Secure` follow the request scheme for that
  reason (`internal/api/flow.go`), which a `__Host-` cookie cannot.
  On an `http://` development origin the binding cookie therefore drops the
  `__Host-` prefix and `Secure` and keeps `HttpOnly`, `Path=/`, and
  `SameSite=Lax`; on every `https://` origin the prefix is required.

The engine owns the protocol parameters of the authorize request: `client_id`,
`redirect_uri`, `response_type`, `scope`, `state`, `nonce`, `code_challenge`,
and `code_challenge_method`, and reserves `response_mode`, `request`, and
`request_uri` (the callback accepts the query response mode only).
It composes the request itself on every attempt.
`static_authorize_parameters` cannot carry these keys (the connection schema
rejects them; validator rule "Reserved Authorize Parameter" in
[area 1](1-resource-model.md#validator-rules)), and if a reserved key reaches
the engine anyway it drops the configured value and keeps its own.

## Callback Processing

The callback phase executes six sequential steps in order; an error at any step
ends the attempt:

1. **State:** An unknown, expired, or already-consumed `state` parameter
   triggers a flow-level error with a restart route (bypassing step transitions,
   as the originating flow session may no longer exist).
2. **Code Exchange:** Performed at the connection's token endpoint and
   authenticated per `token_endpoint_auth_method`.
   *(Note: Resolving the secret value remains an open dependency).*
3. **ID Token Validation (OIDC):**
    - **Signature:** verified with keys from discovery metadata or the
      connection's `jwks_uri`; fails if neither yields keys.
      This runtime check enforces that a `jwks_uri` is required when discovery
      documents are absent, which the schema cannot express.
    - **Algorithms:** asymmetric only, from a fixed allowlist; `none` and the
      HMAC family are rejected.
      `none` is unsigned, and HS256 signs with the shared client secret, so
      anyone holding the secret can forge a token.
    - **Claims:** validates `iss`, `aud` (client ID, checking `azp` when
      multiple audiences are present), `exp` with bounded clock skew, and
      `nonce` from the state record.
    - **Discovery:** when used, must return an `issuer` equal to the configured
      one (OIDC Discovery 4.3).
      Discovery and JWKS documents are cached with a bounded TTL and refetched
      at most once per attempt on an unknown `kid`.
4. **Claims Extraction:** Extracted from `id_token` when `id_token_mapping` is
   set; otherwise from `userinfo`.
   For OIDC, a `userinfo` response whose `sub` does not exactly match the
   id_token `sub` fails the attempt (OIDC Core 5.3.2); without that check, a
   provider mixup could attach another subject's claims.
   Any configured `supplementary_fetch` always runs and overwrites same-named
   claims from either source (see
   [area 1](1-resource-model.md#vendor-knowledge-is-data)).
5. **Verification Evaluation:** Applies `verified_claims` rules to determine
   claim trust:
    - **Claim Lookup:** Strictly boolean `true` or string `"true"` evaluates as
      verified.
      Any other value, including a missing claim, evaluates as unverified.
    - **Literal `true`:** Inherently trusts the provider.
    - **`"$supplementary_fetch"`:** Takes the strategy execution result for this
      attempt, resolved through `claim_mapping` to the claim the strategy
      reports, matching the server's
      [Invalid Strategy Pointer](1-resource-model.md#validator-rules) rule.
6. **Identity Resolution:** Looks up `(connection, external_subject)` where the
   stored subject is strictly a string:
    - **Numeric Coercion:** a provider may send the subject as a JSON number
      (GitHub's `id`).
      It is converted to its exact decimal string, so `12345` and `"12345"`
      resolve to one identity.
      The decoder reads the number as raw text (`json.Number`), never as
      `float64`: a float holds 53 bits, larger ids round, and two distinct
      subjects that round to the same string would merge into one account.
      The legacy mapper's `FormatFloat` path
      ([`oauth/mapper.go#L35-L47`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/idp/providers/oauth/mapper.go#L35-L47))
      has exactly this flaw.
    - **Rejection Criteria:** Absent, `null`, empty, boolean, object, or array
      subjects immediately reject the attempt.
    - **Connection Keying:** The `connection` half of the key requires a
      revision-stable identity (an open item exported to the CRUD API).

> **Porting note:** Two behaviors in steps 3 and 5 cannot be lifted from the
> `zitadel/zitadel` providers.
>
> - **`nonce`:** the legacy provider never sends or verifies one
>   ([`oidc/oidc.go#L143-L166`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/idp/providers/oidc/oidc.go#L143-L166)).
> - **Unrecognized verification values:** step 5 evaluates them as unverified;
>   the legacy userinfo decode fails the whole fetch instead (`oidc.Bool`
>   accepts only `true`/`false`, as boolean or string, and errors on anything
>   else).
>
> The algorithm allowlist does fall out: legacy's verifier defaults to
> `RS256, ES256, PS256`, rejecting `none` and HMAC.

### Server-Side Fetch Policy

Every URL the engine fetches for a connection is tenant-authored (discovery,
`jwks_uri`, token, userinfo, strategy fetch); on shared infrastructure that is a
server-side request forgery surface.
Webhooks and actions need the same guard, so egress policy is its own epic
([#928](https://github.com/zitadel/nextgen/issues/928)).
#928 owns the deny mechanics and an operator allowlist mode.
This area consumes the policy and carries two constraints into it:

- **Blocking for 851.**
  The callback processor fetches discovery, JWKS, token, userinfo, and the
  strategy URL, so SSO cannot ship to shared infrastructure without at least the
  baseline deny behaviour: resolve the host, reject private, loopback,
  link-local, and metadata ranges (RFC 1918, `127.0.0.0/8`, `169.254.169.254`,
  and their IPv6 equivalents), connect to the address that passed the check, and
  repeat the check on every redirect hop; cap redirect count, response size, and
  total fetch time; send only the connection's own credentials, never
  instance-internal headers.
- **Not configurable per connection.**
  The connection schema carries no egress fields.
  Whether and how operators configure the policy belongs to the epic.

Local development instances may relax the loopback rejection so
`http://localhost` providers work, matching the schema's TLS exception
([area 1](1-resource-model.md#the-connection-schema)).

## Resolution Branches

A single `transitions.callback` cannot route returning users and new users to
different locations, so resolution fires one of three outcomes.
Two are shipped; the third, `identity_unknown`, is new and fires only from
SSO resolution, never from a typed identifier.

**Why `identity_unknown` is needed:**
*   **Why not `user_not_found`:** A shared entry step hosts both the typed
    email field and the SSO buttons, and a transition key allows one target.
    Reusing `user_not_found` for an unknown SSO subject would demand two
    targets from the same key: the generic `register` step for a typed email,
    the collection step for SSO.
    The key would have to keep its typed-email target, sending the unknown SSO
    user to the register step to start the ceremony over.
*   **The split:** `identity_unknown` routes the unknown SSO user straight to
    the data collection step, while `user_not_found` keeps its route for typed
    emails.
*   **Engine behavior:** When it fires, the engine flips `CurrentPurpose` from
    `login` to `register`, as it does for `user_not_found`.
    This departs from ADR 017's SSO note
    ([ADR 017](../../adrs/017-flow-engine-auth-attempt-dispatch.md#note-sso)),
    which expected ceremonies to reuse `user_not_found` and to add
    `user_link_required` for linking; 851 adds `identity_unknown` for the
    shared-step reason above, and `user_link_required` is not added, since
    linking is out of scope ([area 1](1-resource-model.md#linking-safety)).
    The ADR's deferred passkey outcome (`credential_unknown`) has the same
    shape.
    ADR 017 needs an amendment, exported in
    [area 4](4-cli-provider-setup.md#dependencies).

An unknown subject resolves identically from either entry step: same outcome,
same resulting purpose.

### The Three Outcomes

When callback processing completes, identity resolution fires exactly one of
three outcomes on the step that started the ceremony, and the step's authored
transitions route it:

| Resolution State | Outcome Fired | Routing & Engine Behavior |
| :--- | :--- | :--- |
| **Known subject** | `callback` | **Targets `done` (Authenticated).** Identity is pinned to `(connection, subject)`, not to claims, so profile edits cannot fork accounts. A sign-in does not update the stored user from fresh claims; that refresh is `is_auto_update`, deferred with its guards ([area 1](1-resource-model.md#deferred-and-cut-fields)). |
| **Unknown subject** | `identity_unknown` | **Targets the data collection step** ([New Users: Prefill and Confirm](#new-users-prefill-and-confirm); `register-sso` in area 4's scaffold). Under `creation: disabled`, `identity_unknown` is not raised; the unknown subject is an error on the originating step ([Failures and Recovery](#failures-and-recovery)). |
| **Unknown subject with unique-property collision** | `user_already_exists` | **Targets the conflict resolution step** ([Conflict Resolution Flow](#conflict-resolution-flow); `sso-conflict` in area 4's scaffold). The engine binds the attempt to the colliding account, and a correct password or passkey on that step signs that account in. |

### Creation Without Collection (`creation: auto`)

Under `creation: auto` (the default), the engine **creates the account
immediately without pausing for collection** and fires `callback` as a newly
authenticated user, provided the mapped claims supply every required property in
the schema.

* **Fallback Behavior:** If a required property is missing, execution degrades
  to `identity_unknown` → data collection, prefilled with what did arrive.
  This is the epic's new-user journey: the user provides only what the provider
  did not return.
* **Unverified Identifiers:** A required property with a non-empty `x-unique`
  scope that arrives unverified (Step 5 of Callback Processing) degrades the
  attempt to collection, and the value is treated as user-typed.
  * This is parity with typed sign-up, not verification. Typed sign-up does not
    verify identifiers today
    ([`capabilities.md`, Missing](../flowengine/capabilities.md#missing)), so
    until email verification exists the gate only removes the provider's
    shortcut past collection.
  * The catalog defaults pass (`email_verified` for Google,
    `$supplementary_fetch` for GitHub); a Google account with
    `email_verified: false` collects instead.
  * Without this gate an attacker's unverified claim to a victim's email
    creates the account first, and the victim meets the conflict step at their
    own sign-up.
* **Disabled:** under `creation: disabled` an unknown subject is an error on
  the step the user started from; `identity_unknown` is not raised
  ([Failures and Recovery](#failures-and-recovery)).
  The provider signs in existing users only.
  The deferred `auto_only` errors on incomplete claims rather than
  collecting ([area 1](1-resource-model.md#provisioning)).
* **Static Warnings:** The plan phase warns when a pairing makes the gate
  statically dead (see [validator rules](1-resource-model.md#validator-rules)).
* **Verification Gating (deferred):** When `x-verify` returns to the dialect,
  every required property carrying it must also arrive verified (Step 5 of
  Callback Processing), otherwise the attempt degrades to collection.
  `x-verify` was removed as unread
  ([#901](https://github.com/zitadel/nextgen/pull/901)) and no schema can carry
  it today, so beyond the `x-unique` gate above 851 enforces no verification on
  either creation path.
  Enforcement becomes real per schema when an author marks a property
  `x-verify`; committed connections do not change.
  See the dependency note in
  [`1-resource-model.md`](1-resource-model.md#linking-safety).

### Constraints & Edge Cases

- **Cross-Schema Identities:** Known-subject resolution assumes the user belongs
  to the flow's pinned schema.
  Resolving an identity arriving through a flow pinned to a *different* schema
  remains an open question.
  Until it is settled, when the resolved user's schema differs from the flow's
  pinned schema, the attempt ends in the flow-level error surface instead of
  adopting either schema partway. The error shows no resolved values; the details go to
  the server log. The real resolution rules are the open point below.
- **Pattern Environments:** Under an `issuer_pattern` environment the engine
  renders a step carrying `sso_providers` without its provider buttons and
  records a diagnostic naming the step and the environment.
  A submission that arrives anyway is refused before any authorize URL is built
  and ends in the flow-level error surface.
- **Unresolvable Provider:** An attempt whose slug does not resolve to a live
  connection at attempt start ends in the flow-level error surface.
  This is reachable through the API path when a connection is deleted while a
  flow still offers it, because a page rendered before the delete can still
  submit.
- **No Auto-Linking in 851:** Linking policy fields are omitted from the current
  schema.
  All account-linking semantics are deferred to the dedicated account-linking
  specification.
- **Validation Rule:** Steps containing `sso_providers` **must** explicitly
  route all three outcomes (`callback`, `identity_unknown`, and
  `user_already_exists`) to prevent flow dead-ends (validator rule in
  [`2-auth-method-selection.md`](2-auth-method-selection.md); today only
  `transitions.callback` is enforced).

## New Users: Prefill and Confirm

The schema author determines which fields the collection step renders, while the
engine populates their values at runtime.
This separation is necessary because external providers cannot guarantee claim
availability for every user (e.g., GitHub's `name` may be `null`, or an `email`
may arrive missing) and a single collection step may handle incoming users from
multiple identity providers.

### Engine Rules for Prefill & Confirmation

* **Claim Mapping:** The engine prefills step fields using mapped claims
  configured in `claim_mapping`.
* **Required Fields:** Required schema properties that arrive empty must be
  manually completed by the user.
* **Optional Fields:** An omitted optional provider claim is silently skipped
  and does not block the step.
* **User Edits:** Prefilled fields are editable.
  `x-editable` was removed in
  [#901](https://github.com/zitadel/nextgen/pull/901) and returns with the
  collection-step implementation; until then editability is uniform.
* **Verification Loss on Edit:** Editing a prefilled value immediately revokes
  its verified status.
  Because the provider only vouches for its own returned data, modified inputs
  must re-enter the standard verification pipeline (`x-verify`).
  This prevents users from replacing a verified prefilled email with an
  arbitrary address while retaining the verified flag.

* **No Wire Change:** `api/openapi/components/flows/field.yaml` already defines
  `value` for prefilled fields. After a successful callback the engine fills it
  from mapped claims.

## The Resolved External Identity

Following a successful callback, the engine holds the **resolved external
identity**: an ephemeral object attached directly to the attempt.

### Payload Structure

- **Coerced subject:** The string-normalized external identifier.
- **Mapped claims:** Profile attributes extracted and mapped from the provider.
- **Verification results:** Per-claim verification status determined during
  callback evaluation.
- **Connection revision:** The pinned connection revision tied to the attempt.
- **What is absent:** Provider access, refresh, and ID tokens.
  They exist only inside callback processing and are dropped when it returns;
  nothing in 851 persists a provider token.

### Consumers

The resolved external identity is read by four key mechanisms:

- **Collection Step Prefill:** Supplies initial values to prefill form fields.
- **Verification Loss Guard:** Enforces the edit-drops-verification rule if
  prefilled inputs are modified.
- **Submission Collision Check:** Validates property uniqueness before account
  creation.
- **Atomic Creation (`create_user_with_sso`):** Consumes the payload atomically
  to provision the user record.

### Open Items & Integration

* **Storage Shape:** Whether this payload lives as explicit fields directly on
  the attempt record or as a sibling record alongside the `state` store remains
  an open design point.
* **Account Linking:** The deferred account-linking journey will anchor directly
  to this resolved external identity object.

## Conflict Resolution Flow

Scoped by the epic: a safe recovery route, without introducing automatic linking
or leaving the user at a dead end.

```
user_already_exists → authored step: "an account with this email already exists"
  → action: sign in → transition with action: "switch" to the login flow
  → user authenticates with existing factors → continues to the app
```

* **Account binding:** The engine binds the attempt to the colliding account.
  `register → password` uses the same binding when a typed value collides; here
  the key is the mapped claim value.
* **Credential check:** A password or passkey submit on the conflict step
  authenticates the colliding account. Throttling and lockout policies are
  shared with the `password` step. The credential must still be correct; what
  the step confirms about account existence is covered by the enumeration note
  below.

### Navigation Mechanics: `switch` vs. `pivot`

* **Why `switch` is required:** `pivot` pushes the login flow and auto-pops back
  to the paused conflicted flow on completion, returning the user to the
  conflict step instead of the application.
  Conversely, `switch` replaces the current flow without a return path (its
  documented design covers navigating between peer flows like login ↔ register).
* **Flow Target Resolution:** The single-definition default has no other
  definition to switch to, so the scaffold uses in-definition navigation
  re-purposed to login
  ([`4-cli-provider-setup.md`](4-cli-provider-setup.md#flow-architecture-decisions)).

### Trigger Points

The `user_already_exists` outcome fires at **two distinct execution points**,
and the flow must route both:

1. **Callback Resolution:** Triggered when provider-supplied values collide with
   an existing user record.
2. **Collection Step Submission:** Triggered when a user edits a prefilled field
   into a conflicting value (matching standard registration submission
   semantics).

Both the entry step and the collection step carry the `user_already_exists`
transition.

> **Enumeration Note:** The conflict step and the `user_already_exists` outcome
> behind it confirm to the person completing the ceremony that an account with
> the colliding value exists.
> This is a recorded trade-off, not an oversight.
> The shipped default flow already answers registration submissions with
> `user_already_exists` (`packages/config/defaults/default-login.json:112`), so
> social sign-in adds no oracle beyond that baseline, and a generic failure
> instead would leave the account's legitimate owner at exactly the dead end the
> epic forbids.
> The probe also costs more than form-based enumeration, because each attempt
> requires a real authentication at the provider.

### Identity Lifecycle

* **Account linking is out of scope:** The verified external identity is
  **discarded at the conflict boundary**.
  No user record is created, no email-based linking is attempted, and the user
  receives a clear explanation without reaching a dead end.
  The identity dies with the attempt, and every later sign-in through that
  provider repeats the conflict until the linking journey is implemented.

## Failures and Recovery

Failures never trigger a step transition, keeping the outcome vocabulary
strictly bounded.
Most surface as errors on the originating step; state and binding-cookie
failures surface as a flow-level error with a restart route, since the
originating flow session may no longer exist.
Per the epic's security and UX principles, failures provide a clear explanation
and recovery route without exposing internal technical details to the end user.

| Failure Scenario | Error Surface | Recovery Mechanism |
| :--- | :--- | :--- |
| **User cancels / provider denies (`access_denied`)** | Originating step with a localized `text_key` error. | The step remains rendered, allowing the user to retry or select another offered authentication method. |
| **Provider configuration error (invalid client, bad scope)** | Originating step with a generic `text_key` error. | Details are written to the server log; tenant-side misconfigurations are hidden from the end user. |
| **State expired, unknown, or reused** | Flow-level error with a restart route. | Restarts the flow entirely, as the originating flow session may no longer exist. |
| **Binding cookie absent or mismatched** | Flow-level error with a restart route. | The callback's `state` is consumed: the authorization code arrived with this request, so the original tab could never complete the ceremony anyway. The user restarts from the flow. |
| **Code exchange / `userinfo` failure** | Originating step with a generic error. | The user can retry; detailed error diagnostics are written to server logs. |
| **Unknown subject under `creation: disabled`** | Originating step with a localized `text_key` error. | The provider signs in existing users only. The step remains rendered; the user signs in with an existing account or picks another offered method. |
| **Verification shortfall** | Handled via normal resolution branches. | Handled automatically by resolution rules; the user never sees technical errors referencing claims. |

## Dependencies

| Requirement | Owed By / Target |
| :--- | :--- |
| **Callback URI Surface:** Expose `{origin}/__nextgen/idp/callback` in the setup journey and per environment. | CLI Journey (Area 4) |
| **Flow Scaffolding:** Scaffold `sso_providers` on the entry steps (both, in the shipped shared-entry default) and the conflict step with its login route. | CLI Journey (Area 4) |
| **Callback Route:** Register route under the server HTTP surface; the scaffolded proxy matcher is already prefix-wide (`/__nextgen/:path*`), so no patcher work remains. | Server |
| **Localization Keys:** Export conflict-step copy (the account-exists explanation plus its submit, passkey, and sign-in actions), error copy, and provider button labels as `text_key` entries. | Login UI / Locale Work |
| **UI & Branding Assets:** Add conditional SSO blocks to all five branding `login.liquid` templates and `default.liquid`; add provider glyphs to `zl-icon`. | Branding Defaults / Components |
| **`<zl-sso-providers>` and `sso-redirect`:** An atom rendering one button per provider (`name` and `template` on the rendered step, filled by the engine from the connection; `template` is the brand hint) that submits `{action: "sso", sso_provider_id}`, and orchestrator navigation when a step carries `redirect_url`. | Components / Orchestrator |
| **Failure-Details Channel:** Details are written to the server log; tenant-side misconfigurations are hidden from the end user. The log never carries authorization codes, tokens, or secret values; claim values follow `x-audit`'s deny-by-default; access logs redact `code` and `state` from the callback query. | Engine; the login UI shows the generic error |

## Open Points

* **Cross-Schema Subject Resolution:** Identity links are
  `(connection, subject)` pairings, which are schema-agnostic, but users belong
  to specific schemas and flows pin one schema revision.
  The rule is undecided for a known subject whose user belongs to a schema
  other than the one the active flow pins.
    * *Candidate Rules:* Per-schema identity spaces (requires per-schema
      uniqueness, which `x-unique` lacks), a global hard-block error, or
      erroring until decided.
    * *Ownership & Scope:* Belongs to the identity-link data model (requiring a
      revision-stable connection identity and schema *lineage* tracking).
      In 851 the mismatch ends the attempt in the flow-level error surface
      ([Constraints & Edge Cases](#constraints--edge-cases)), which is a dead
      end for the person signing in.
      Reachable in 851 once a second schema enables the same connection through
      the Sign-in methods journey's schema picker (area 4,
      [Post-Claim Re-entry](4-cli-provider-setup.md#post-claim-re-entry)).
      The concrete two-schema case is recorded in area 1's
      [Linking Safety](1-resource-model.md#linking-safety); the product decision
      is listed in the [README](README.md#product-decisions).
* **Social Sign-in in Pattern Environments:** Open, and not 851's to decide.
  Providers accept only exact registered redirect URIs, and a preview origin is
  new on every deploy.
  Any approach needs a fixed callback host registered with the provider that
  forwards `code` and `state` unexchanged (the `__Host-` binding cookie lives on
  the originating origin) and hands back only to the origin in the single-use
  `state` record, never to any origin that merely matches the pattern.
  Belongs to the platform's environment design
  ([`configuration-surface.md`](../platform/configuration-surface.md#environments),
  [#534](https://github.com/zitadel/nextgen/issues/534)).
  Until decided, pattern environments render without providers
  ([Constraints & Edge Cases](#constraints--edge-cases)).
* **State Storage Shape:** Fields on the attempt, or a dedicated table.
  Consumption must be atomic under concurrent duplicate callbacks (one succeeds,
  the second gets a reused-state error); `zitadel/zitadel` has no such guard
  ([`idp_intent.go#L169-L199`](https://github.com/zitadel/zitadel/blob/d488ecb07ffe82d1e5493e9482be48a3e82397cc/internal/command/idp_intent.go#L169-L199))
  and no TTL on a pending state.
  Minting is unauthenticated, so the engine caps pending records per flow and
  rate-limits minting (both 851 requirements); the shape must keep both cheap.
* **Multi-Tab Behavior:** Defining rules for parallel SSO submissions initiated
  from a single flow (whether the last-minted state invalidates prior states or
  both remain valid until consumed).
  The binding cookie shares this decision: one named `__Host-` cookie holds a
  single value per host, so a second tab's ceremony overwrites the first tab's
  nonce and fails it at callback; per-attempt cookie names versus accepting the
  overwrite must be settled together with the state rule.
* **`sso-redirect` Step Shape:** Confirming whether `{name, redirect_url}`
  (sketched in example 4) serves as the official wire contract or if the
  redirect URL should be folded directly into the submission response payload.
  The return leg is settled in [The `state` Record](#the-state-record): the
  record carries the return target and the callback route consumes it, never
  reading a destination from callback input.

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1: connection schema,
  dependencies)
- [`2-auth-method-selection.md`](2-auth-method-selection.md) (area 2:
  capability/usage split)
- [`../flowengine/flow-engine.md`](../flowengine/flow-engine.md) (example 4, the
  SSO sketch)
- [`../flowengine/flow-engine-nodes.md`](../flowengine/flow-engine-nodes.md)
  (step response shape)
- [`../flowengine/capabilities.md`](../flowengine/capabilities.md) (what is
  stubbed)
- `internal/domain/flow_state_machine.go` (the SSO stub), `flow_on_success.go`
  (the `on_success` handler interface `create_user_with_sso` joins)
