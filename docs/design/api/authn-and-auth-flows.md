# Authentication and Auth Flows

> The `auth_attempts` state machine, the OIDC compatibility adapter, and how the embedded-component / SSR handoff hangs together. For vocabulary, [`../glossary.md`](../glossary.md). For credentials, [`credentials.md`](credentials.md).

## Separation of responsibilities

- **auth_attempts** — ephemeral state machine exposing the auth *primitives*: start an attempt, issue factor challenges, verify factor proofs, and mint handoff tokens. Lives in `api/` because it's a core protocol surface.
- **OIDC adapter** — server-side handler for `/authorize` and `/token`. Stores OIDC request context in its own `auth_requests` table and drives `auth_attempts` internally. The auth_attempt has no OIDC-specific payload.
- **flow engine** — orchestrates the *UI* around those primitives: which step renders when, which screen to show next, when to branch on policy. Does not hold primitives. See [`../flowengine/flow-engine.md`](../flowengine/flow-engine.md).
- **sessions** — durable post-auth container produced by a completed auth_attempt. Carries accumulated factors and `assurance_levels[]`. Detail in [`../flowengine/session-api.md`](../flowengine/session-api.md).

A flow runs on top of auth_attempt primitives without collapsing the resource model. A flow decides *what screen to draw*; an auth_attempt decides *what primitive to offer and what proof to accept*; a session is the durable post-auth outcome. The `/flow/{id}` handle is the flow's own `id` from the latest response — it is distinct from the stable underlying `session_id` and from `auth_attempt_id`, and it may change on pivot or pop.

## Pre-session concepts

| Term | Meaning |
|---|---|
| **Factor** | A verified credential: passkey, password, OTP, recovery code, federated assertion. |
| **Auth method** | The operation that acquires a factor: `password verify`, `passkey assert`, `otp enroll`, `federation redirect`. |
| **Challenge** | A single-factor prompt issued inside an auth_attempt. |
| **Session** | The post-auth container holding verified factors. Carries `assurance_levels[]`, the set of currently satisfied assurance profiles. |
| **Step-up** | Adding factors to an existing session to raise assurance. |

## Bootstrap challenge

Every auth_attempt begins with a server-minted, origin-bound nonce. The client gets the nonce from `POST /bootstrap/challenge` (direction: the `challenge_nonce` request field is shipped on `POST /auth_attempts`, but the `/bootstrap/challenge` endpoint that mints it is not yet in the OpenAPI spec):

```http
POST /bootstrap/challenge
{
  "project_id": "proj_01HEXAMPLE",
  "client_type": "browser" | "native_ios" | "native_android" | "server"
}
```

For `browser`, the server validates the `Origin` header against the project's `allowed_origins` before minting. The nonce is bound to `{project_id, origin, ttl≈60s, single_use}` and echoed on the subsequent `POST /auth_attempts`.

Detail in [`credentials.md`](credentials.md#origin-bound-browser-challenges). Disambiguation: this is **not** the same as `POST /projects` — that creates a whole project. This mints a per-session nonce. See [`../platform/claim-flow.md`](../platform/claim-flow.md) for project bootstrap.

## The auth_attempt state machine

```http
POST   /auth_attempts                              # create
GET    /auth_attempts/{id}                         # poll
POST   /auth_attempts/{id}/challenges              # issue a factor challenge
POST   /auth_attempts/{id}/challenges/{cid}/verify # submit proof
POST   /auth_attempts/{id}/handoff                 # terminal: mint handoff_token
```

`POST /auth_attempts` accepts only the project context, the bootstrap challenge
nonce, and an optional existing session for step-up:

```http
POST /auth_attempts
{
  "project_id": "proj_01HEXAMPLE",
  "challenge_nonce": "…",
  "session_id": "sess_existing"   // optional, for step-up
}
```

`handoff` always yields a `handoff_token`. Who calls it determines the next
step: direct clients and the flow engine exchange it through `POST /sessions/exchange`,
while the OIDC adapter consumes it internally to mint an OAuth code.

### TTL — LOCKED at 15 minutes

Industry standard for OIDC `state` cookies and magic link lifespans. **Not configurable.** Configurability here creates an untested matrix and a footgun (a 24-hour TTL is an attacker's dream). Background GC cleans up abandoned attempts. If real use cases emerge for longer flows, we revisit with actual data.

> **Note:** 15-minute TTL means high churn on the table. Needs partitioning or efficient deletion strategy, not row-by-row cleanup.

## OIDC compatibility

Zitadel is fundamentally an OIDC provider: legacy relying parties redirect to `/authorize` with `client_id`, `redirect_uri`, `state`, `nonce`, `code_challenge`, etc., and expect an OAuth `code` back at the `redirect_uri`.

**LOCKED:** the OIDC adapter handles OIDC context entirely server-side. When
`/authorize` is received, the adapter stores the full request parameters in
`auth_requests`, creates an auth_attempt through the internal service layer,
and links `attempt_id -> auth_request_id`. The auth_attempt remains a pure
authentication primitive.

When the final step calls `mint_handoff(attempt_id)`, the OIDC adapter resolves
the linked auth request, validates the session's `assurance_levels[]` against
the requested `acr_values`, and generates the OAuth `code` + redirect URL. For
step-up, the adapter creates a new auth_attempt against the same `session_id`;
the target ACR stays in `auth_requests`, not on the auth_attempt.

## SSR handoff

The embedded lit component completes auth in-browser and hands the customer's backend a short-lived `handoff_token` to exchange for a real session.

```http
POST /auth_attempts/{id}/handoff         → { handoff_token: "…", exchange_url: "…" , expires_at: "…"}
POST /sessions/exchange                  → { session: {…}, session_token: "…" }
```

Exchange requirements (also documented in [`credentials.md`](credentials.md#handoff-token-hardening)):

- Single-use (atomic GETDEL).
- TTL ≤ 60 seconds.
- Audience-bound: exchange requires an `sk_proj_…` whose project ID matches the handoff's minted project.
- Idempotency-safe via the optional `Idempotency-Key` header (see [`conventions.md`](conventions.md#idempotency-shipped)). Packet loss on the success response must not lock out the user.

## Sessions

Once an auth_attempt completes, the result is a durable session. Sessions are
never mutated directly by a client; all factor mutations happen through
auth_attempts. The session is a read model that reflects the accumulated,
verified state:

```http
POST   /sessions                         # pre-allocate anonymous session (optional, pre-auth)
GET    /sessions/me                      # read the caller's session (__nextgen_session cookie)
DELETE /sessions/me                      # end-user logout (__nextgen_session cookie)
GET    /sessions/{id}                    # read state, factors, assurance_levels[] (operator, session.read)
DELETE /sessions/{id}                    # operator revoke (session.delete; idempotent 204)
POST   /sessions/query                   # operator list — cursor-paginated, structured filters
```

`POST /sessions` is optional — it creates an anonymous shell (no user, no factors) for cases where a `session_id` must be pre-allocated before the user is known. Most clients skip this; the flow engine and direct `auth_attempts` callers create the session implicitly on first completion.

Sessions carry `assurance_levels[]` — every assurance level the current factors
satisfy. OIDC-specific `acr` and `amr` claims are projected by the OIDC adapter.
Detail in [`../flowengine/session-api.md`](../flowengine/session-api.md). Step-up
re-authentication creates a new auth_attempt against the same session, adds
factors, and expands `assurance_levels[]`.

### Step-Up

Step-up re-authentication creates a new `auth_attempt` against the **same `session_id`**, adds factors, and expands `assurance_levels[]`. No new session is created. No OIDC context on the attempt — when triggered by an OIDC flow, the `acr_values` target is in the OIDC Adapter's stored `auth_request`.

```http
POST /auth_attempts
{
  "project_id":      "proj_…",
  "challenge_nonce": "…",
  "session_id":      "sess_existing"
}
```

The attempt proceeds normally (challenges → verify → handoff). On handoff, the session's `factors` and `assurance_levels[]` are updated in place.

## Flow engine integration

The flow engine is a separate concern from auth_attempts: it decides *which step renders* at each point. A flow step that says "collect password" internally invokes the auth_attempt **Go service layer** (the same code that backs the `POST /auth_attempts/{id}/challenges` HTTP endpoint) with `method: "password"` and presents the resulting challenge to the user. The submission invokes the service-layer equivalent of `POST /auth_attempts/{id}/challenges/{cid}/verify`. **The flow engine never makes HTTP round-trips to its own REST endpoints** — it calls the underlying Go service directly, the same pattern as the OIDC adapter.

`auth_attempts` does not return an "available factors" menu for orchestration.
Step selection remains flow/policy-driven; auth_attempts enforces validity of
requested methods and proofs.

Integration details and the full state machine of the UI orchestration layer live in [`../flowengine/flow-engine.md`](../flowengine/flow-engine.md).

## Sequence Diagrams

Three flows share the same `auth_attempts` primitives. They differ in who drives the UI and what the terminal output is.

### Path 1 — Web client via Flow Engine (embedded component + SSR handoff)

The browser loads a Zitadel-hosted login component (or an embedded lit element). The flow engine drives all UI decisions server-side. The customer's backend exchanges the final `handoff_token` for a session.

```mermaid
sequenceDiagram
    autonumber
    participant Browser
    participant Bootstrap as Bootstrap handler
    participant FlowEngine as Flow Engine
    participant AuthAttempts as auth_attempts svc
    participant SessionDB as Sessions (DB)
    participant CustomerBackend as Customer Backend

    Note over FlowEngine,AuthAttempts: All FlowEngine→AuthAttempts calls are internal Go service calls,<br/>not HTTP. The REST endpoints (POST /auth_attempts/…) are the<br/>public surface for direct-API clients only (Path 2).

    Note over Browser,CustomerBackend: Bootstrap

    Browser->>Bootstrap: POST /bootstrap/challenge { project_id, client_type: "browser" }
    Bootstrap-->>Browser: { challenge_nonce }

    Note over Browser,CustomerBackend: Optional — pre-allocate session before user is known

    Browser->>SessionDB: POST /sessions { project_id, user_agent }
    SessionDB-->>Browser: { session_id, session_token, state: "building", assurance_levels: [] }

    Note over Browser,CustomerBackend: Start auth attempt (flow engine path)

    Browser->>FlowEngine: POST /flow { project_id, challenge_nonce, session_id? }
    FlowEngine->>AuthAttempts: svc.Create({ project_id, challenge_nonce, session_id? })
    AuthAttempts-->>FlowEngine: { attempt_id }
    FlowEngine->>AuthAttempts: svc.IssueChallenge(attempt_id, { method: "identifier" })
    AuthAttempts-->>FlowEngine: { challenge_id, method: "identifier" }
    FlowEngine-->>Browser: Set-Cookie: flow=<encrypted_state> · 200 { step: "identifier" }

    Note over Browser,CustomerBackend: Factor 1 — identifier + password

    Browser->>FlowEngine: POST /flow/{id}/submit { login_name: "alice@acme.com" }
    FlowEngine->>AuthAttempts: svc.VerifyChallenge(attempt_id, cid, { login_name: "alice@acme.com" })
    AuthAttempts-->>FlowEngine: OK — identifier verified
    FlowEngine->>AuthAttempts: svc.IssueChallenge(attempt_id, { method: "password" })
    AuthAttempts-->>FlowEngine: { challenge_id, method: "password" }
    FlowEngine-->>Browser: Set-Cookie: flow=<encrypted_state> · 200 { step: "password" }

    Browser->>FlowEngine: POST /flow/{id}/submit { password: "…" }
    FlowEngine->>AuthAttempts: svc.VerifyChallenge(attempt_id, cid, { password: "…" })
    AuthAttempts-->>FlowEngine: OK — factor written to auth_attempt
    FlowEngine-->>Browser: Set-Cookie: flow=<encrypted_state> · 200 { step: "totp" }

    Note over Browser,CustomerBackend: Factor 2 — TOTP (policy required MFA)

    Browser->>FlowEngine: POST /flow/{id}/submit { method: "totp" }
    FlowEngine->>AuthAttempts: svc.IssueChallenge(attempt_id, { method: "totp" })
    AuthAttempts-->>FlowEngine: { challenge_id, method: "totp" }
    Browser->>FlowEngine: POST /flow/{id}/submit { totp: { code: "123456" } }
    FlowEngine->>AuthAttempts: svc.VerifyChallenge(attempt_id, cid, { totp: { code: "123456" } })
    AuthAttempts-->>FlowEngine: OK — factor written, assurance_levels[] updated
    FlowEngine->>AuthAttempts: svc.Handoff(attempt_id)
    AuthAttempts-->>FlowEngine: { handoff_token, expires_at }
    FlowEngine-->>Browser: Set-Cookie: flow=<cleared> · 200 { step: "complete", handoff_token: "…", expires_at: "…" }

    Browser->>CustomerBackend: POST /auth/callback { handoff_token }
    CustomerBackend->>SessionDB: POST /sessions/exchange { handoff_token } (sk_proj_ auth)
    SessionDB-->>CustomerBackend: { session_id, session_token, assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"], factors: {…} }


    Browser->>CustomerBackend: POST /auth/callback { handoff_token }
    CustomerBackend->>SessionDB: POST /sessions/exchange { handoff_token } (sk_proj_ auth)
    SessionDB-->>CustomerBackend: { session_id, session_token, assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"], factors: {…} }
    CustomerBackend-->>Browser: Set-Cookie: session=… · 302 redirect to app

    Note over Browser,CustomerBackend: Later — read session

    CustomerBackend->>SessionDB: GET /sessions/{id} (Bearer session_token)
    SessionDB-->>CustomerBackend: { assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"], factors: {…} }
```

---

### Path 2 — Direct API client (mobile app, CLI, backend service)

The client owns all UI. It drives `auth_attempts` directly without a flow engine.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Bootstrap as Bootstrap handler
    participant AuthAttempts as auth_attempts
    participant SessionDB as Sessions (DB)

    Note over Client,SessionDB: Bootstrap

    Client->>Bootstrap: POST /bootstrap/challenge { project_id, client_type: "native_ios" }
    Bootstrap-->>Client: { challenge_nonce }

    Note over Client,SessionDB: Start attempt

    Client->>AuthAttempts: POST /auth_attempts { project_id, challenge_nonce }
    AuthAttempts-->>Client: { attempt_id }

    Note over Client,SessionDB: Identify user

    Client->>AuthAttempts: POST /auth_attempts/{id}/challenges { method: "identifier" }
    AuthAttempts-->>Client: { challenge_id }
    Client->>AuthAttempts: POST /auth_attempts/{id}/challenges/{cid}/verify { login_name: "alice@acme.com" }
    AuthAttempts-->>Client: { user_id }

    Note over Client,SessionDB: Factor 1 — password

    Client->>AuthAttempts: POST /auth_attempts/{id}/challenges { method: "password" }
    AuthAttempts-->>Client: { challenge_id }

    Client->>AuthAttempts: POST /auth_attempts/{id}/challenges/{cid}/verify { password: "…" }
    AuthAttempts-->>Client: 200 OK

    Note over Client,SessionDB: Factor 2 — TOTP

    Client->>AuthAttempts: POST /auth_attempts/{id}/challenges { method: "totp" }
    AuthAttempts-->>Client: { challenge_id }

    Client->>AuthAttempts: POST /auth_attempts/{id}/challenges/{cid}/verify { totp: { code: "123456" } }
    AuthAttempts-->>Client: 200 OK

    Note over Client,SessionDB: Complete — receive handoff_token, exchange for session

    Client->>AuthAttempts: POST /auth_attempts/{id}/handoff
    AuthAttempts-->>Client: { handoff_token, expires_at }

    Client->>SessionDB: POST /sessions/exchange { handoff_token } (sk_proj_ auth)
    SessionDB-->>Client: { session_id, session_token, assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"], factors: {…} }

    Note over Client,SessionDB: Use session

    Client->>SessionDB: GET /sessions/{id} (Bearer session_token)
    SessionDB-->>Client: { assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"], factors: {…} }
```

---

### Path 3 — OIDC RP (legacy relying party via /authorize)

The RP redirects to `/authorize`. The OIDC Adapter is server-side code handling the request in-process — it stores OIDC context in `auth_requests`, creates an `auth_attempt` via the internal service layer, and links them. Terminal output is an OAuth `code` at the `redirect_uri`.

```mermaid
sequenceDiagram
    autonumber
    participant Browser
    participant RP as Relying Party
    participant OIDCAdapter as OIDC Adapter
    participant FlowEngine as Flow Engine
    participant AuthService as Auth Service (internal)
    participant DB as Database

    Note over Browser,DB: RP initiates auth

    Browser->>RP: GET /protected-resource
    RP-->>Browser: 302 → /authorize?client_id=…&redirect_uri=…&scope=openid&acr_values=urn:nist:aal:2&state=…&nonce=…&code_challenge=…

    Browser->>OIDCAdapter: GET /authorize?…
    OIDCAdapter-)DB: INSERT auth_requests { client_id, redirect_uri, acr_values, state, nonce, code_challenge, … }
    OIDCAdapter-)AuthService: create_auth_attempt(project_id) → attempt_id
    OIDCAdapter-)DB: link attempt_id → auth_request_id
    OIDCAdapter-->>Browser: 302 → /login?attempt_id=… (hosted login UI)

    Note over Browser,DB: Flow engine drives login (same as Path 1, steps omitted)

    Browser->>FlowEngine: POST /flow { attempt_id }
    FlowEngine-->>Browser: { step: "identifier" }
    Note right of Browser: … identifier → password → totp steps …
    FlowEngine-->>Browser: { step: "complete" }

    Note over Browser,DB: Terminal — final submit triggers handoff internally
    FlowEngine-)AuthService: mint_handoff(attempt_id) → handoff_token
    AuthService--)FlowEngine: { handoff_token }
    FlowEngine-)OIDCAdapter: exchange handoff_token (internal)
    OIDCAdapter-)DB: SELECT auth_request WHERE attempt_id = …
    DB--)OIDCAdapter: { acr_values, redirect_uri, state, nonce, … }
    OIDCAdapter-)DB: SELECT assurance_levels FROM sessions WHERE id = … (verify assurance_levels[] ⊇ acr_values)
    DB--)OIDCAdapter: { assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"] } ✓
    OIDCAdapter--)FlowEngine: { code, redirect_uri: "https://app.acme.com/callback?code=…&state=…" }
    FlowEngine-->>Browser: 302 → https://app.acme.com/callback?code=…&state=…

    Note over Browser,DB: RP exchanges code for tokens

    Browser->>RP: GET /callback?code=…&state=…
    RP->>OIDCAdapter: POST /token { code, code_verifier, redirect_uri }
    OIDCAdapter-)DB: SELECT assurance_levels FROM sessions WHERE id = …
    DB--)OIDCAdapter: { assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"] }
    OIDCAdapter-->>RP: { access_token, id_token (acr: "urn:nist:aal:2"), refresh_token }
    RP-->>Browser: Set-Cookie: session · redirect to /protected-resource
```

---

### Step-Up — existing session, RP requests higher ACR

```mermaid
sequenceDiagram
    autonumber
    participant Browser
    participant RP as Relying Party
    participant OIDCAdapter as OIDC Adapter
    participant FlowEngine as Flow Engine
    participant AuthService as Auth Service (internal)
    participant DB as Database

    Note over Browser,DB: User has active session at AAL1

    Browser->>RP: GET /sensitive-action
    RP-->>Browser: 302 → /authorize?acr_values=urn:nist:aal:2&…

    Browser->>OIDCAdapter: GET /authorize?acr_values=urn:nist:aal:2&…
    OIDCAdapter-)DB: SELECT assurance_levels FROM sessions WHERE id = …
    DB--)OIDCAdapter: { assurance_levels: ["urn:nist:aal:1"] }
    Note right of OIDCAdapter: aal:2 not in assurance_levels[] → step-up required

    OIDCAdapter-)DB: INSERT auth_requests { acr_values: "urn:nist:aal:2", redirect_uri, state, … }
    OIDCAdapter-)AuthService: create_auth_attempt(session_id: "existing") → attempt_id
    OIDCAdapter-)DB: link attempt_id → auth_request_id
    OIDCAdapter-->>Browser: 302 → /login?attempt_id=… (step-up UI — identifier/password skipped)

    Note over Browser,DB: Flow engine resolves acr_values from auth_request, renders only missing factor

    Browser->>FlowEngine: POST /flow { attempt_id }
    Note right of FlowEngine: lookup auth_request via attempt_id → acr_values = aal:2<br/>policy_check: session has password, only totp missing
    FlowEngine-->>Browser: { step: "totp" }

    Browser->>FlowEngine: POST /flow/{id}/submit { method: "totp" }
    FlowEngine-)AuthService: issue_challenge(method: "totp")
    AuthService--)FlowEngine: { challenge_id }
    Browser->>FlowEngine: POST /flow/{id}/submit { totp: { code: "123456" } }
    FlowEngine-)AuthService: verify_challenge(challenge_id, totp: { code: "123456" })
    AuthService-)DB: write totp factor, recompute assurance_levels[]
    DB--)AuthService: assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"]
    AuthService--)FlowEngine: OK
    FlowEngine-->>Browser: { step: "complete" }

    FlowEngine-)AuthService: mint_handoff(attempt_id) → handoff_token
    AuthService--)FlowEngine: { handoff_token }
    FlowEngine-)OIDCAdapter: exchange handoff_token (internal)
    OIDCAdapter-)DB: SELECT auth_request WHERE attempt_id = …
    OIDCAdapter-)DB: SELECT assurance_levels FROM sessions WHERE id = … → assurance_levels[] ⊇ aal:2 ✓
    OIDCAdapter--)FlowEngine: { code, redirect_uri }
    FlowEngine-->>Browser: 302 → https://app.acme.com/callback?code=…&state=…

    Browser->>RP: GET /callback?code=…
    RP->>OIDCAdapter: POST /token { code, … }
    OIDCAdapter-)DB: SELECT assurance_levels FROM sessions WHERE id = …
    DB--)OIDCAdapter: { assurance_levels: ["urn:nist:aal:1","urn:nist:aal:2"] }
    OIDCAdapter-->>RP: { id_token (acr: "urn:nist:aal:2") }
    RP-->>Browser: access granted
```

## See also

- [`../glossary.md`](../glossary.md)
- [`credentials.md`](credentials.md) — bootstrap nonce, handoff token hardening
- [`authz.md`](authz.md) — who can create an auth_attempt
- [`conventions.md`](conventions.md#idempotency-shipped) — Category B retry semantics
- [`../flowengine/flow-engine.md`](../flowengine/flow-engine.md) — UI orchestration on top of these primitives
- [`../flowengine/session-api.md`](../flowengine/session-api.md) — durable sessions, ACR/AAL
