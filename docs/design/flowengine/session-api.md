# Session API

> **Status:** Preliminary — direction is set, details are open
> **See also:** [Overview](README.md) · [OpenAPI spec](api/session-api.yaml) · [Glossary](../glossary.md) · [auth_attempts state machine](../api/authn-and-auth-flows.md)
>
> The session-as-factor-accumulator model and ACR-based assurance are the intended direction. The specifics — JSON Schema for ACR level definitions, `x-freshness` semantics — are proposals, not decisions. The policy engine design (which consumes and evaluates ACR levels) is not yet written.

Sessions are the durable, post-auth primitive. A session accumulates verified authentication factors and carries the set of ACR levels its current factors satisfy. Sessions are **read-only from the client's perspective** — factors only flow in through `auth_attempts`. The client reads the session state; it never pushes factor proofs directly to a session.

## Relation to `auth_attempts`

A session is produced by a completed [auth_attempt](../api/authn-and-auth-flows.md). auth_attempts are the **ephemeral pre-auth state machine** — they expose the primitives (challenges, verify, handoff token minting) that drive a single authentication round. The session is the durable outcome: it survives the attempt and becomes the thing the customer's app holds on to.

- **auth_attempt**: ephemeral, 15-min TTL, one handoff_token terminal. Accepts proofs, issues challenges, verifies credentials.
- **session**: durable, holds factors + ACR list, readable and revocable by the client. **Never mutated directly.** Factor mutations happen exclusively through `auth_attempts`.

```
POST /auth_attempts                       →  drive verification (challenges, proofs)
POST /auth_attempts/{id}/handoff          →  mint handoff_token
POST /session_handoffs/{id}/exchange      →  receive { session, session_token }

GET    /sessions/{id}                     →  read state, factors, acr[], amr
DELETE /sessions/{id}                     →  revoke (logout)
```

Step-up re-authentication creates a **new auth_attempt against the same `session_id`**, adds factors, and expands the satisfied ACR list. The session accumulates.

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
  "factors": {},
  "acr": [],
  "amr": []
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
| **How the client interacts** | Client pushes "checks" — telling the server _what_ to verify. Anti-pattern: the client owns verification logic. | Client drives `auth_attempts`. Session is a read model. |
| **Session lifecycle** | Implicit — exists or doesn't. | Explicit: `building → active → expired \| revoked`. |
| **Assurance** | Not modeled. External logic decides "done." | `acr[]` — all ACR levels the current factors satisfy. Whether any of them is enough depends on the request context. |
| **Step-up / re-auth** | Not modeled. Requires new session. | New `auth_attempt` against same session — adds factors, expands the satisfied ACR list. |
| **Protocol** | gRPC + REST gateway | REST/JSON native |
| **Factor types** | user, password, web_auth_n, idp_intent, totp, otp_sms, otp_email, recovery_code | Same set. Submitted as _proofs_ via `auth_attempts`, not as _checks_ on the session. |

**Why this matters:**
- **No "checks" anti-pattern.** Proofs (a password value, an OTP code, a passkey assertion) go to `auth_attempts`. The session reflects the verified outcome.
- **No binary "sufficient".** The session reports all ACR levels its factors satisfy; the consumer decides if its required level is in that list. A session satisfying AAL2 also satisfies AAL1.
- Step-up auth works naturally: the RP requests a higher ACR → a new `auth_attempt` adds factors → the session's `acr[]` expands.

## Assurance Levels and ACR

The session model is built around **Authentication Context Class Reference (ACR)** from OpenID Connect and **Authenticator Assurance Levels (AAL)** from NIST SP 800-63.

### Core Concepts

| Concept | What it means |
|---|---|
| **ACR** (Authentication Context Class Reference) | Assurance level identifier. The session exposes `acr[]` (all satisfied levels). OIDC ID tokens carry a single `acr` claim chosen from that list for the specific request. |
| **AMR** (Authentication Methods References) | List of method identifiers used during authentication (e.g., `["pwd", "otp", "mfa"]`). Appears in OIDC ID tokens as the `amr` claim. |
| **AAL** (Authenticator Assurance Level) | NIST's classification: AAL1 (single factor), AAL2 (two factors), AAL3 (hardware + phishing-resistant). |

### How It Works

1. The session **accumulates factors** — each with `verified_at` timestamp and authenticator properties. Factors are written by completing `auth_attempts`.
2. The policy engine **defines ACR levels as JSON Schema** — each level specifies which factors are required, their combination logic, and freshness constraints.
3. The session's `acr[]` is the **list of all levels whose schemas the current factors satisfy**. AAL levels are cumulative: a session satisfying AAL2 always includes AAL1 in its list.
4. Whether any of those levels is "enough" depends on the **request context** (`acr_values`, application policy, action sensitivity).

### ACR Level Definitions as JSON Schema

Each ACR level is defined by a JSON Schema that the session's `factors` object must satisfy. The schema can encode factor requirements, alternatives, and **freshness constraints**.

**AAL1 — single factor, verified within 24h:**

```json
{
  "acr": "urn:zitadel:aal:1",
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
  "acr": "urn:zitadel:aal:2",
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
  "acr": "urn:zitadel:aal:3",
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
- The session's `acr[]` **shrinks over time** without the session itself expiring — AAL2 drops out while AAL1 remains.
- Step-up re-authentication (a new `auth_attempt` against the same session) refreshes the factor's `verified_at`, restoring the higher level to the list.

### Factor Freshness in Practice

```
Session factors:
  user:     { verified_at: "2026-04-17T08:00:00Z" }
  password: { verified_at: "2026-04-17T08:00:00Z" }
  totp:     { verified_at: "2026-04-17T08:01:00Z" }

Current time: 2026-04-17T14:00:00Z (6h later)

AAL2 schema requires: totp.verified_at within 4h
TOTP verified 6h ago → FAILS freshness check

Current acr[]: ["urn:zitadel:aal:1"]   (AAL2 dropped out; password still fresh within 24h)
```

The session is still valid. An RP requiring AAL1 finds it in the list and succeeds. An RP requiring AAL2 does not find it — the IdP triggers step-up: a new `auth_attempt` is created against this session, the user re-verifies TOTP, and AAL2 is restored to the list.

### Custom ACR Levels

Teams can define custom ACR values with their own schemas:

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

Custom levels appear in `acr[]` alongside standard AAL levels when their schemas are satisfied.

## Endpoints

```
POST   /sessions                     Create anonymous session shell (pre-auth)
GET    /sessions/{id}                Get session state, factors, acr[], amr
DELETE /sessions/{id}                Revoke session (logout)
GET    /sessions                     List sessions (admin / management)
```

Factor proofs are **not submitted here**. They go to:

```
POST   /auth_attempts                               Start authentication (references session_id optionally)
POST   /auth_attempts/{id}/challenges               Issue a factor challenge
POST   /auth_attempts/{id}/challenges/{cid}/verify  Submit proof
POST   /auth_attempts/{id}/handoff                  Mint handoff_token
POST   /session_handoffs/{id}/exchange              Exchange handoff_token → { session, session_token }
```

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
                  │  active                              │◄─── step-up expands acr[]
                  │  acr[] may shrink as factors age     │
                  │                                      │
                  └──────────┬───────────────────────────┘
                        ┌────┴────┐
                        ▼         ▼
                  ┌─────────┐ ┌─────────┐
                  │ expired │ │ revoked │
                  └─────────┘ └─────────┘
```

A session transitions to `active` when it has at least one verified authentication factor (beyond just user identification). `active` does not mean "enough for all purposes" — the consumer checks whether its required ACR level appears in `acr[]`.

## `session_token` Lifecycle

The `session_token` is the bearer credential that authorises session-scoped operations (`DELETE`).

| Event | Token |
|---|---|
| `POST /sessions` (anonymous) | Initial `session_token` issued |
| `POST /session_handoffs/{id}/exchange` | Fresh `session_token` issued, supersedes the anonymous token |
| `DELETE /sessions/{id}` | Token consumed (session revoked) |

> **Important:** After a handoff exchange, clients must replace the anonymous `session_token` with the one returned from the exchange. The anonymous token is invalidated at that point.

The token is **not** rolled on `GET` reads — it is a stable credential until the session is upgraded or revoked.

## Step-Up Authentication

A user has an active session. Its `acr[]` contains only AAL1. An RP requests AAL2:

```
RP → /authorize?acr_values=urn:zitadel:aal:2
IdP: GET /sessions/{id} → acr[] = ["urn:zitadel:aal:1"]
IdP: "urn:zitadel:aal:2 not in list — trigger step-up"

→ POST /auth_attempts { challenge_nonce: "…", session_id: "sess_abc" }
→ POST /auth_attempts/{id}/challenges { method: "totp" }
→ POST /auth_attempts/{id}/challenges/{cid}/verify { totp: { code: "123456" } }
→ POST /auth_attempts/{id}/handoff
  → session acr[] updated to ["urn:zitadel:aal:1", "urn:zitadel:aal:2"]

IdP: GET /sessions/{id} → "urn:zitadel:aal:2" ∈ acr[] ✓
IdP: issues ID token with acr: "urn:zitadel:aal:2"
```

The **same session** is used. No new session is created. Factors accumulate and `acr[]` grows.

### Factor Freshness Triggers Step-Up

```
RP → /authorize?acr_values=urn:zitadel:aal:2
IdP: GET /sessions/{id}
  acr[] = ["urn:zitadel:aal:1"]          ← AAL2 not present (TOTP stale)
  factors.totp.verified_at = 5h ago       ← exceeds 4h freshness window

IdP: "urn:zitadel:aal:2 not in list — trigger step-up"
→ new auth_attempt against same session_id
→ user re-verifies TOTP → totp.verified_at updated
→ acr[] = ["urn:zitadel:aal:1", "urn:zitadel:aal:2"]
```

## Context-Specific Evaluation

The session exposes `acr[]` — all levels its current factors satisfy. Whether any of those levels is "enough" is determined by the **request context**:

| Context | Who decides | How |
|---|---|---|
| OIDC auth request | RP via `acr_values` or `claims` parameter | IdP checks if required value is in session `acr[]` |
| Resource server (step-up) | RS via `WWW-Authenticate` header (RFC 9470) | Client re-authorizes with `acr_values` |
| Flow engine | Policy engine per step | `policy_check` step checks if required level is in session `acr[]` |
| Admin console action | Policy per action sensitivity | "Delete team" requires AAL3 ∈ acr[]; "view settings" requires AAL1 ∈ acr[] |

The session never says "I am sufficient." It says "I satisfy these levels." The consumer decides if its required level is in the list.

## Supported Factor Types

| Factor | Proof payload (sent via auth_attempts) | Requires | AAL contribution |
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

## Database Schema

```sql
CREATE TABLE sessions (
    id              TEXT        NOT NULL,
    project_id      TEXT        NOT NULL,
    version         INTEGER     NOT NULL DEFAULT 1,
    state           TEXT        NOT NULL,       -- 'building', 'active', 'expired', 'revoked'
    user_id         TEXT,
    factors         JSONB       NOT NULL DEFAULT '{}', -- verified factor events with timestamps + properties
    acr             TEXT[]      DEFAULT '{}',   -- all ACR levels currently satisfied (recomputed on auth_attempt completion)
    amr             TEXT[]      DEFAULT '{}',   -- authentication methods used
    metadata        JSONB       NOT NULL DEFAULT '{}',
    user_agent      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,                -- short TTL for anonymous sessions; reset on first factor write

    PRIMARY KEY (project_id, id)
);
```
