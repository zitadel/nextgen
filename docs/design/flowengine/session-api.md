# Session API

> **Status:** Preliminary — direction is set, details are open
> **See also:** [Overview](README.md) · [Shipped spec](../../../api/openapi/endpoints/sessions/) · [Glossary](../glossary.md) · [auth_attempts state machine](../api/authn-and-auth-flows.md)
>
> The session-as-factor-accumulator model and assurance-profile evaluation are the intended direction. The specifics — JSON Schema for assurance profile definitions and `x-freshness` semantics — are proposals, not decisions. The policy engine design (which consumes and evaluates assurance levels) is not yet written.

Sessions are the durable, post-auth primitive. A session accumulates verified authentication factors and exposes `assurance_levels[]`, the set of assurance profiles its current factors satisfy. Sessions are read-only from the client's perspective: factors flow in through `auth_attempts`, and clients read or revoke the resulting session.

## Relation to `auth_attempts`

A session is produced by a completed [auth_attempt](../api/authn-and-auth-flows.md). auth_attempts are the **ephemeral pre-auth state machine** — they expose the primitives (challenges, verify, handoff token minting) that drive a single authentication round. The session is the durable outcome: it survives the attempt and becomes the thing the customer's app holds on to.

- **auth_attempt**: ephemeral, 15-min TTL, one handoff_token terminal. Accepts proofs, issues challenges, verifies credentials.
- **session**: durable, holds factors + `assurance_levels[]`, readable and revocable by the client. Never mutated directly by client proof submission.

```
POST /auth_attempts                       →  drive verification (challenges, proofs)
POST /auth_attempts/{id}/handoff          →  mint handoff_token
POST /sessions/exchange { handoff_token }  →  receive { session, session_token }

GET    /sessions/{id}                     →  read state, factors, assurance_levels[] (operator)
DELETE /sessions/me                       →  end-user logout (__nextgen_session cookie)
DELETE /sessions/{id}                     →  operator revoke (session.delete scope, idempotent 204)
```

Step-up re-authentication creates a **new auth_attempt against the same `session_id`**, adds factors, and expands the satisfied assurance level list. The session accumulates.

## Anonymous Sessions

`POST /sessions` creates an anonymous session shell — no user, no factors, `state: building`. This exists for two use cases:

1. **Pre-allocating a `session_id`** before the user is known. Useful when embedding a login flow and you want to correlate device/telemetry data with the eventual authenticated session from the start.
2. **Tracking anonymous state** (e.g. bot detection signals, device fingerprint) that should survive until the user authenticates.

```http
POST /sessions
{
  "project_id": "proj_…",
  "user_agent": { "fingerprint": "…", "ip": "…" }
}
```

```json
{
  "session_id": "sess_abc123",
  "session_token": "stok_initial_…",
  "state": "building",
  "factors": [],
  "assurance_levels": []
}
```

The `session_token` returned here authorises the `DELETE` (revoke) call. It is **superseded** when an `auth_attempt` completes and the handoff is exchanged — the exchange returns a fresh `session_token` tied to the authenticated session. Clients should replace their stored token at that point.

### Anonymous Session TTL

Anonymous sessions (no verified factors) expire aggressively: **10 minutes**, reset when an `auth_attempt` upgrades them. An `auth_attempt` created with a `session_id` that references an anonymous session resets its expiry to the normal session TTL (hours/days) once the first factor is verified.

> **Note:** The `expires_at` field in the DB schema (and the response) reflects the current TTL regime. A session transitions from the short anonymous TTL to the configured session TTL the moment the first auth factor is written by a completing `auth_attempt`.

A subsequent `POST /auth_attempts` referencing the pre-allocated `session_id` upgrades it:

```http
POST /auth_attempts
{
  "project_id": "proj_…",
  "challenge_nonce": "…",
  "session_id": "sess_abc123"   ← links to the anonymous session
}
```

The flow engine does this internally. Direct-API clients do it explicitly.

## Changes from the Current v2 Session API

The current v2 API (`CreateSession` / `SetSession` / `GetSession` / `DeleteSession`) treats the session as a **dumb container** — the caller pushes checks into it and external logic (OIDC middleware, login UI) decides if the session is "done." The new design makes sessions **assurance-aware** and **read-only post-auth**.

| | Current v2 | New Design |
|---|---|---|
| **Who decides what's needed** | The caller. No guidance from the server. | The policy engine. Evaluates factors against ACR level definitions. |
| **How the client interacts** | Client pushes "checks" — telling the server _what_ to verify. Anti-pattern: the client owns verification logic. | Client drives `auth_attempts`; session is a read model. |
| **Session lifecycle** | Implicit — exists or doesn't. | Explicit: `building → active → expired` (revocation deletes the session). |
| **Assurance** | Not modeled. External logic decides "done." | `assurance_levels[]` lists all levels the current factors satisfy. Whether any is enough depends on the request context. |
| **Client guidance** | None. | Flow/policy layer decides what to ask for; the session itself does not prescribe next steps. |
| **Step-up / re-auth** | Not modeled. Requires new session. | New auth_attempt against the same session — adds factors and expands `assurance_levels[]`. |
| **Protocol** | gRPC + REST gateway | REST/JSON native |
| **Factor types** | user, password, web_auth_n, idp_intent, totp, otp_sms, otp_email, recovery_code | Same set. Submitted as proofs through `auth_attempts`, not as checks on the session. |
| **Challenges** | `RequestChallenges` field inside `CreateSession`/`SetSession` | Issued by `POST /auth_attempts/{id}/challenges` |

**Why this matters:**
- **No "checks" anti-pattern.** Proofs (a password value, an OTP code, a passkey assertion) go to `auth_attempts`. The session reflects the verified outcome.
- **No binary "sufficient".** The session reports all assurance levels its factors satisfy; the request context determines if one of them is enough.
- Step-up auth works naturally: the RP requests a higher assurance level → a new auth_attempt adds factors → `assurance_levels[]` expands.

## Assurance Levels (and OIDC ACR Mapping)

The session model is built around **Authentication Context Class Reference (ACR)** from OpenID Connect and **Authenticator Assurance Levels (AAL)** from NIST SP 800-63.

### Core Concepts

| Concept | What it means                                                                                                                                                                |
|---|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ACR** (Authentication Context Class Reference) | OIDC claim name for assurance context. Core sessions expose `assurance_levels[]`; the OIDC adapter maps one requested/eligible value to the token `acr` claim.               |
| **AMR** (Authentication Methods References) | List of method identifiers used during authentication (e.g., `["pwd", "otp", "mfa"]`). Appears in OIDC ID tokens as the `amr` claim. Not stored or exposed in core sessions. |
| **AAL** (Authenticator Assurance Level) | NIST's classification: AAL1 (single factor), AAL2 (two factors), AAL3 (hardware + phishing-resistant).                                                                       |

### How It Works

1. The session **accumulates factors** — each with `verified_at` timestamp and authenticator properties. Factors are written by completing auth_attempts.
2. The policy engine **defines assurance levels as JSON Schema** — each level specifies which factors are required, their combination logic, and freshness constraints.
3. The session's `assurance_levels[]` is the **list of all levels whose schemas the current factors satisfy**. AAL levels are cumulative: a session satisfying AAL2 also satisfies AAL1.
4. Whether any level is "enough" depends on the **request context** (`acr_values`, application policy, action sensitivity).

### ACR Level Definitions as JSON Schema

Zitadel ships **default assurance profile packs** as starting points. The first default pack is expected to be **NIST-referenced** (SP 800-63 AAL1/AAL2/AAL3), using neutral ACR identifiers such as `urn:nist:aal:1`, `urn:nist:aal:2`, and `urn:nist:aal:3` in examples.

The defaults are not exclusive. Teams can:

- adopt additional profile packs (for other standards bodies),
- define country- or sector-specific assurance schemas in their own deployment,
- contribute reusable schema packs back to the ecosystem.

Each deployment decides which profile packs are enabled and which identifiers are accepted for `acr_values`.

Each assurance level is defined by a JSON Schema that the session's `factors` object must satisfy. The schema can encode factor requirements, alternatives, and **freshness constraints**.

**AAL1 — single factor, verified within 24h:**

```json
{
  "acr": "urn:nist:aal:1",
  "schema": {
    "type": "object",
    "required": ["user"],
    "anyOf": [
      {
        "required": ["password"],
        "properties": {
          "password": {
            "type": "object",
            "properties": {
              "verified_at": { "x-freshness": "24h" }
            }
          }
        }
      },
      {
        "required": ["idp"],
        "properties": {
          "idp": {
            "type": "object",
            "properties": {
              "verified_at": { "x-freshness": "24h" }
            }
          }
        }
      }
    ]
  }
}
```

**AAL2 — two factors or multi-factor authenticator, second factor within 4h:**

```json
{
  "acr": "urn:nist:aal:2",
  "schema": {
    "type": "object",
    "required": ["user"],
    "oneOf": [
      {
        "required": ["password", "totp"],
        "properties": {
          "password": {
            "type": "object",
            "properties": { "verified_at": { "x-freshness": "24h" } }
          },
          "totp": {
            "type": "object",
            "properties": { "verified_at": { "x-freshness": "4h" } }
          }
        }
      },
      {
        "required": ["password", "otp_sms"],
        "properties": {
          "password": {
            "type": "object",
            "properties": { "verified_at": { "x-freshness": "24h" } }
          },
          "otp_sms": {
            "type": "object",
            "properties": { "verified_at": { "x-freshness": "4h" } }
          }
        }
      },
      {
        "required": ["passkey"],
        "properties": {
          "passkey": {
            "type": "object",
            "properties": {
              "verified_at": { "x-freshness": "4h" },
              "user_verified": { "const": true }
            }
          }
        }
      }
    ]
  }
}
```

**AAL3 — hardware + phishing-resistant, within 1h:**

```json
{
  "acr": "urn:nist:aal:3",
  "schema": {
    "type": "object",
    "required": ["user", "passkey"],
    "properties": {
      "passkey": {
        "type": "object",
        "properties": {
          "verified_at": { "x-freshness": "1h" },
          "user_verified": { "const": true },
          "hardware": { "const": true },
          "phishing_resistant": { "const": true }
        },
        "required": ["verified_at", "user_verified", "hardware", "phishing_resistant"]
      }
    }
  }
}
```

### The `x-freshness` Extension

`x-freshness` is a custom JSON Schema keyword that the policy engine evaluates at runtime. It compares the factor's `verified_at` timestamp against `now() - duration`. If the factor is older than the allowed window, it fails validation for that level.

This means:
- A factor can satisfy AAL2 right after verification but stop satisfying it after the freshness window expires.
- The session's `assurance_levels[]` **shrinks over time** without the session itself expiring — AAL2 drops out while AAL1 remains.
- Step-up re-authentication creates a new auth_attempt against the same session and refreshes the factor's `verified_at`, restoring the higher level.

### Factor Freshness in Practice

```
Session factors:
  user:     { verified_at: "2026-04-17T08:00:00Z" }
  password: { verified_at: "2026-04-17T08:00:00Z" }
  totp:     { verified_at: "2026-04-17T08:01:00Z" }

Current time: 2026-04-17T14:00:00Z (6h later)

AAL2 schema requires: totp.verified_at within 4h
TOTP verified 6h ago → FAILS freshness check

Current assurance_levels[]: ["urn:nist:aal:1"]   (AAL2 dropped out; password still fresh within 24h)
```

The session is still valid. An RP requiring AAL1 finds it in the list and succeeds. An RP requiring AAL2 does not find it — the IdP triggers step-up: a new `auth_attempt` is created against this session, the user re-verifies TOTP, and AAL2 is restored to the list.

### Custom Assurance Levels

Teams can define custom assurance values with their own schemas:

```json
{
  "acr": "urn:acme:high-security",
  "schema": {
    "type": "object",
    "required": ["user", "passkey", "captcha"],
    "properties": {
      "passkey": {
        "type": "object",
        "properties": {
          "verified_at": { "x-freshness": "30m" },
          "hardware": { "const": true }
        },
        "required": ["verified_at", "hardware"]
      },
      "captcha": { "type": "object" }
    }
  }
}
```

Custom levels appear in `assurance_levels[]` alongside default NIST levels when their schemas are satisfied.

## Endpoints

```
POST   /sessions                     Create anonymous session shell (pre-auth)
GET    /sessions/me                  Get the caller's session (__nextgen_session cookie)
DELETE /sessions/me                  End-user logout (__nextgen_session cookie)
GET    /sessions/{id}                Get session state, factors, assurance_levels[] (operator, session.read)
DELETE /sessions/{id}                Operator revoke (session.delete; idempotent — 204 even if already gone)
POST   /sessions/query               Query sessions (operator; cursor-paginated, structured filters)
```

Factor proofs are **not submitted here**. They go to:

```
POST   /auth_attempts                               Start authentication (references session_id optionally)
POST   /auth_attempts/{id}/challenges               Issue a factor challenge
POST   /auth_attempts/{id}/challenges/{cid}/verify  Submit proof
POST   /auth_attempts/{id}/handoff                  Mint handoff_token
POST   /sessions/exchange                           Exchange handoff_token → { session, session_token }
```

### `POST /sessions/exchange`

Consumes a one-time `handoff_token` minted by `POST /auth_attempts/{id}/handoff`. The server resolves the originating `auth_attempt` from the token and then decides:

| Situation | Outcome |
|---|---|
| `auth_attempt` had **no `session_id`** | New authenticated session is **created** |
| `auth_attempt` had a `session_id` pointing to an **anonymous shell** | Existing session is **upgraded** — user and factors written in, TTL reset to full session TTL |
| `auth_attempt` had a `session_id` pointing to an **active session** (step-up) | Existing session is **upgraded** — new factors merged, `assurance_levels[]` expanded |

The caller does not need to know which case applies — the response shape is identical in all three.

**Request**

```http
POST /sessions/exchange
Authorization: Bearer sk_proj_…   ← project service key
Content-Type: application/json

{
  "handoff_token": "handoff_…"
}
```

**Response**

```json
{
  "session": {
    "session_id":        "sess_…",
    "state":             "active",
    "user_id":           "user_…",
    "factors":           [ { "method": "identifier", "verified_at": "…", "payload": { "user_id": "user_…" } }, { "method": "password", "verified_at": "…" } ],
    "assurance_levels":  ["urn:nist:aal:1", "urn:nist:aal:2"],
    "created_at":        "…",
    "expires_at":        "…"
  },
  "session_token": "stok_…"
}
```

- `session_token` supersedes any previously issued anonymous `session_token` for the same session. Clients must replace their stored token at this point.
- The `handoff_token` is single-use; replaying it returns `410 Gone`.

See [auth_attempts state machine](../api/authn-and-auth-flows.md) for the full endpoint reference.

## Session Lifecycle

```
                  ┌──────────────────────────────────────┐
                  │                                      │
  POST /sessions  │  anonymous (building, short TTL)     │
  (optional)      │  no user, no factors                 │
                  └───────────────┬──────────────────────┘
                                  │ auth_attempt completes,
                                  │ first factor written
                                  ▼
                  ┌──────────────────────────────────────┐
                  │                                      │
                  │  building                            │◄─── step-up auth_attempt
                  │  has user factor, gathering more     │     adds more factors
                  │                                      │
                  └───────────────┬──────────────────────┘
                                  │ has at least one
                                  │ authentication factor
                                  ▼
                  ┌──────────────────────────────────────┐
                  │                                      │
                  │  active                              │◄─── step-up expands assurance_levels[]
                  │  assurance_levels[] may shrink       │
                  │  as factors age                      │
                  └───────────────┬──────────────────────┘
                                  │ TTL elapses
                                  ▼
                          ┌─────────┐
                          │ expired │
                          └─────────┘
```

A session transitions to `active` when it has at least one verified authentication factor (beyond just user identification). `active` does not mean "enough for all purposes" — the consumer checks whether its required assurance level appears in `assurance_levels[]`. There is no `revoked` state: revocation deletes the session, so a revoked session simply stops existing (and the operator delete is idempotent).

## Handoff Exchange

`POST /sessions/exchange` consumes a one-time `handoff_token` minted by
`POST /auth_attempts/{id}/handoff`. The server resolves the originating
auth_attempt from the token and then decides:

| Originating auth_attempt | Session result |
|---|---|
| No `session_id` | New authenticated session is created. |
| `session_id` points to an anonymous shell | Existing session is upgraded: user and factors are written in, TTL resets to the full session TTL. |
| `session_id` points to an active session | Existing session is upgraded for step-up: new factors merge in, `assurance_levels[]` expands. |

Example response:

```json
{
  "session": {
    "session_id": "sess_abc",
    "state": "active",
    "factors": [
      { "method": "identifier", "verified_at": "2026-04-17T10:00:00Z", "payload": { "user_id": "user_123" } },
      { "method": "password", "verified_at": "2026-04-17T10:01:00Z" },
      { "method": "passkey", "verified_at": "2026-04-17T10:02:00Z" }
    ],
    "assurance_levels": ["urn:nist:aal:1", "urn:nist:aal:2"]
  },
  "session_token": "tok_final"
}
```
> **Important:** After a handoff exchange, clients must replace the anonymous `session_token` with the one returned from the exchange. The anonymous token is invalidated at that point.

### Step-Up Authentication

A user has an active session at AAL1 (password only). An RP requests AAL2:

```
RP → /authorize?acr_values=urn:nist:aal:2
IdP checks session: assurance_levels[] = ["urn:nist:aal:1"]
IdP: "need a second factor" → starts auth_attempt against same session
User verifies TOTP through auth_attempt → assurance_levels[] includes urn:nist:aal:2
IdP issues ID token with acr: "urn:nist:aal:2"
```

The **same session** is used. No new session is created. Factors accumulate and `assurance_levels[]` grows.

### Factor Freshness Triggers Step-Up

```
RP → /authorize?acr_values=urn:nist:aal:2&max_age=300
IdP checks session:
  - password: verified 2h ago (within 24h limit → OK)
  - totp: verified 5h ago (exceeds 4h freshness → STALE)
  - assurance_levels[] = ["urn:nist:aal:1"]

IdP: "TOTP is stale, need a fresh second factor"
User verifies fresh TOTP through a new auth_attempt → assurance_levels[] includes urn:nist:aal:2
```

## Context-Specific Evaluation

The session stores factors and exposes `assurance_levels[]`. Whether any of
those levels is "enough" is determined by the **request context**:

| Context | Who decides | How |
|---|---|---|
| OIDC auth request | RP via `acr_values` or `claims` parameter | OIDC adapter checks whether the requested value is in `assurance_levels[]` and maps it to the token `acr` claim. |
| Resource server (step-up) | RS via `WWW-Authenticate` header (RFC 9470) | Client re-authorizes with `acr_values` |
| Flow engine | Policy engine per step | `policy_check` step checks whether the required level is in `assurance_levels[]`. |
| Admin console action | Policy per action sensitivity | "Delete team" requires AAL3 in `assurance_levels[]`; "view settings" requires AAL1. |

The session itself never says "I am sufficient." It says "these assurance
levels are currently satisfied." The consumer decides if that set is enough.

## Supported Factor Types

| Factor | Proof payload (sent through auth_attempts) | Requires | AAL contribution |
|---|---|---|---|
| `user` | `{ "login_name": "..." }` or `{ "user_id": "..." }` | — | Identifies the user (prerequisite, not a factor) |
| `password` | `{ "password": "..." }` | Prior `user` factor | Knowledge factor → AAL1 |
| `passkey` | `{ "assertion": {...} }` | Prior `user` factor + challenge | Multi-factor (possession + inherence/knowledge) → AAL2 or AAL3 depending on authenticator properties |
| `totp` | `{ "code": "..." }` | Prior `user` factor | Possession factor → AAL2 (with another factor) |
| `otp_sms` | `{ "code": "..." }` | Prior `user` factor + challenge | Possession factor → AAL2 (restricted by NIST) |
| `otp_email` | `{ "code": "..." }` | Prior `user` factor + challenge | Possession factor → AAL2 (restricted by NIST) |
| `idp` | `{ "intent_id": "...", "token": "..." }` | Prior `user` factor | Depends on IdP's own assurance level |
| `recovery_code` | `{ "code": "..." }` | Prior `user` factor | Single-use, not counted toward assurance |
| `captcha` | `{ "provider": "altcha", "salt": "...", "number": ... }` or `{ "provider": "recaptcha", "token": "..." }` | Challenge (from auth_attempt) | Bot detection signal, not an authentication factor |

## Shipped Storage Model

The API response is not a one-to-one projection of the `sessions` table. The
shipped table stores the session key, creation/update timestamps, TTL and
expiry, token reference, optional user reference, and optional user-agent
reference. It does **not** have `state`, `factors`, `assurance_levels`,
`metadata`, or `version` columns.

`state` is derived from expiry and whether verified factors exist. Factors are
loaded from the checks associated with the session, and assurance levels are
computed at runtime rather than persisted. See the current dialect migrations
for the exact DDL:

- [PostgreSQL](../../../internal/storage/dialect/postgres/migration/sql/000007_user_agents_and_sessions.sql)
- [Spanner](../../../internal/storage/dialect/spanner/migration/sql/000007_user_agents_and_sessions.sql)
- [SQLite](../../../internal/storage/dialect/sqlite/migration/sql/000001_init.sql)
