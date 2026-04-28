# Session API

> **Status:** Preliminary — direction is set, details are open
> **See also:** [Overview](README.md) · [API sketch](api/session-api.yaml) · [Glossary](../glossary.md) · [auth_attempts state machine](../api/authn-and-auth-flows.md)
>
> The session-as-factor-accumulator model and assurance-profile evaluation are the intended direction. The specifics — JSON Schema for assurance profile definitions and `x-freshness` semantics — are proposals, not decisions. The policy engine design (which consumes and evaluates assurance levels) is not yet written.

Sessions are the durable, post-auth primitive. A session accumulates verified authentication factors and exposes `assurance_levels[]`, the set of assurance profiles its current factors satisfy. Sessions are read-only from the client's perspective: factors flow in through `auth_attempts`, and clients read or revoke the resulting session.

## Relation to `auth_attempts`

A session is produced by a completed [auth_attempt](../api/authn-and-auth-flows.md). auth_attempts are the **ephemeral pre-auth state machine** — they expose the primitives (challenges, verify, handoff token minting) that drive a single authentication round. The session is the durable outcome: it survives the attempt and becomes the thing the customer's app holds on to.

- **auth_attempt**: ephemeral, 15-min TTL, one handoff_token terminal. Accepts proofs, issues challenges, verifies credentials.
- **session**: durable, holds factors + `assurance_levels[]`, readable and revocable by the client. Never mutated directly by client proof submission.

Step-up re-authentication creates a new auth_attempt against the same session, adds factors, and expands `assurance_levels[]`.

## Changes from the Current v2 Session API

The current v2 API (`CreateSession` / `SetSession` / `GetSession` / `DeleteSession`) treats the session as a **dumb container** — the caller pushes checks into it and external logic (OIDC middleware, login UI) decides if the session is "done." The new design makes sessions **assurance-aware**.

| | Current v2 | New Design |
|---|---|---|
| **Who decides what's needed** | The caller. No guidance from the server. | The policy engine. Evaluates factors against ACR level definitions. |
| **How the client interacts** | Client pushes "checks" — telling the server _what_ to verify. Anti-pattern: the client owns verification logic. | Client drives `auth_attempts`; session is a read model. |
| **Session lifecycle** | Implicit — exists or doesn't. | Explicit: `building → active → expired | revoked`. |
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

## Assurance Levels and ACR

The session model is built around **Authentication Context Class Reference (ACR)** from OpenID Connect and **Authenticator Assurance Levels (AAL)** from NIST SP 800-63.

### Core Concepts

| Concept | What it means |
|---|---|
| **ACR** (Authentication Context Class Reference) | OIDC claim name for assurance context. Core sessions expose `assurance_levels[]`; the OIDC adapter maps one requested/eligible value to the token `acr` claim. |
| **AMR** (Authentication Methods References) | List of method identifiers used during authentication (e.g., `["pwd", "otp", "mfa"]`). Appears in OIDC ID tokens as the `amr` claim. |
| **AAL** (Authenticator Assurance Level) | NIST's classification: AAL1 (single factor), AAL2 (two factors), AAL3 (hardware + phishing-resistant). |

### How It Works

1. The session **accumulates factors** — each with `verified_at` timestamp and authenticator properties. Factors are written by completing auth_attempts.
2. The policy engine **defines assurance levels as JSON Schema** — each level specifies which factors are required, their combination logic, and freshness constraints.
3. The session's `assurance_levels[]` is the **list of all levels whose schemas the current factors satisfy**. AAL levels are cumulative: a session satisfying AAL2 also satisfies AAL1.
4. Whether any level is "enough" depends on the **request context** (`acr_values`, application policy, action sensitivity).

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
- The session's `assurance_levels[]` **shrinks over time** without the session itself expiring.
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

Current assurance_levels[]: ["urn:zitadel:aal:1"] (password still fresh within 24h)
```

The session is still valid. An RP requiring AAL1 finds it in the list and succeeds. An RP requiring AAL2 does not find it and triggers step-up.

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

## Endpoints

```
POST   /sessions                     Optional anonymous pre-auth shell
GET    /sessions                     List sessions (admin / management)
GET    /sessions/{id}                Get session state, factors, assurance_levels[]
DELETE /sessions/{id}                Revoke session

POST   /auth_attempts                Start authentication, references session_id optionally
POST   /auth_attempts/{id}/challenges
POST   /auth_attempts/{id}/challenges/{cid}/verify
POST   /auth_attempts/{id}/handoff
POST   /sessions/exchange            Exchange handoff_token -> { session, session_token }
```

## Session Lifecycle

```
                  ┌──────────┐
  CreateSession → │ building │ ← step-up auth_attempt
                  └────┬─────┘
                       │ auth_attempt completes,
                       │ handoff exchanged
                       ▼
                  ┌──────────┐
                  │  active  │ ← assurance_levels[] may shrink as factors age
                  └────┬─────┘
                  ┌────┴─────┐
                  ▼          ▼
            ┌─────────┐ ┌─────────┐
            │ expired │ │ revoked │
            └─────────┘ └─────────┘
```

A session transitions to `active` when it has at least one verified authentication factor (beyond just user identification). `active` does not mean "enough for all purposes" — the consumer checks whether its required assurance level appears in `assurance_levels[]`.

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
    "factors": {
      "user": { "user_id": "u_123", "verified_at": "2026-04-17T10:00:00Z" },
      "password": { "verified_at": "2026-04-17T10:01:00Z" },
      "otp": { "verified_at": "2026-04-17T10:02:00Z" }
    },
    "assurance_levels": ["urn:zitadel:aal:1", "urn:zitadel:aal:2"],
    "amr": ["pwd", "otp", "mfa"]
  },
  "session_token": "tok_final"
}
```

### Step-Up Authentication

A user has an active session at AAL1 (password only). An RP requests AAL2:

```
RP → /authorize?acr_values=urn:zitadel:aal:2
IdP checks session: assurance_levels[] = ["urn:zitadel:aal:1"]
IdP: "need a second factor" → starts auth_attempt against same session
User verifies TOTP through auth_attempt → assurance_levels[] includes urn:zitadel:aal:2
IdP issues ID token with acr: "urn:zitadel:aal:2"
```

The same session is used. No new session is created. The factors accumulate.

### Factor Freshness Triggers Step-Up

```
RP → /authorize?acr_values=urn:zitadel:aal:2&max_age=300
IdP checks session:
  - password: verified 2h ago (within 24h limit → OK)
  - totp: verified 5h ago (exceeds 4h freshness → STALE)
  - assurance_levels[] = ["urn:zitadel:aal:1"]

IdP: "TOTP is stale, need a fresh second factor"
User verifies fresh TOTP through a new auth_attempt → assurance_levels[] includes urn:zitadel:aal:2
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
| `captcha` | `{ "provider": "altcha", "salt": "...", "number": ... }` or `{ "provider": "recaptcha", "token": "..." }` | Challenge | Bot detection signal, not an authentication factor |

## Database Schema

```sql
CREATE TABLE sessions (
    id              TEXT        NOT NULL,
    project_id      TEXT        NOT NULL,
    version         INTEGER     NOT NULL DEFAULT 1,
    state           TEXT        NOT NULL,       -- 'building', 'active', 'expired', 'revoked'
    user_id         TEXT,
    factors         JSONB       NOT NULL DEFAULT '{}', -- verified factor events with timestamps + properties
    assurance_levels TEXT[]     DEFAULT '{}',   -- all levels currently satisfied
    amr             TEXT[]      DEFAULT '{}',   -- authentication methods used
    metadata        JSONB       NOT NULL DEFAULT '{}',
    user_agent      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,

    PRIMARY KEY (project_id, id)
);
```
