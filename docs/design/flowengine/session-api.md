# Session API

> **Status:** Preliminary — direction is set, details are open
> **See also:** [Overview](README.md) · [OpenAPI spec](api/session-api.yaml) · [Glossary](../glossary.md) · [auth_attempts state machine](../api/authn-and-auth-flows.md)
>
> The session-as-factor-accumulator model and ACR-based assurance are the intended direction. The specifics — JSON Schema for ACR level definitions, `x-freshness` semantics, the `need[]` heuristic — are proposals, not decisions. The policy engine design (which consumes and evaluates ACR levels) is not yet written.

Sessions are the durable, post-auth primitive. A session accumulates verified authentication factors and carries an assurance level (ACR). Any client can use it directly to build custom flows.

## Relation to `auth_attempts`

A session is produced by a completed [auth_attempt](../api/authn-and-auth-flows.md). auth_attempts are the **ephemeral pre-auth state machine** — they expose the primitives (challenges, verify, complete, handoff, OIDC code minting) that drive a single authentication round. The session is the durable outcome: it survives the attempt and becomes the thing the customer's app holds on to.

- **auth_attempt**: ephemeral, 15-min TTL, one OAuth-code or handoff_token terminal.
- **session**: durable, holds factors + ACR, can be stepped up via a new auth_attempt against the same session_id.

Step-up re-authentication creates a new auth_attempt against the same session, adds factors, and raises the assurance level.

## Changes from the Current v2 Session API

The current v2 API (`CreateSession` / `SetSession` / `GetSession` / `DeleteSession`) treats the session as a **dumb container** — the caller pushes checks into it and external logic (OIDC middleware, login UI) decides if the session is "done." The new design makes sessions **assurance-aware**.

| | Current v2 | New Design |
|---|---|---|
| **Who decides what's needed** | The caller. No guidance from the server. | The policy engine. Evaluates factors against ACR level definitions. |
| **How the client interacts** | Client pushes "checks" — telling the server _what_ to verify. Anti-pattern: the client owns verification logic. | Client submits _proofs_ (credentials, assertions). The server decides what they mean. |
| **Session lifecycle** | Implicit — exists or doesn't. | Explicit: `building → active → expired | revoked`. |
| **Assurance** | Not modeled. External logic decides "done." | `acr` computed from factors. Whether it's enough depends on the request context. |
| **Client guidance** | None. | `acr` (current level) + `need[]` (what to submit to reach a target). |
| **Step-up / re-auth** | Not modeled. Requires new session. | Same session — add factors to raise the assurance level. |
| **Protocol** | gRPC + REST gateway | REST/JSON native |
| **Factor types** | user, password, web_auth_n, idp_intent, totp, otp_sms, otp_email, recovery_code | Same set. Submitted as _proofs_, not _checks_. |
| **Challenges** | `RequestChallenges` field inside `CreateSession`/`SetSession` | Separate endpoint: `POST /sessions/{id}/challenge` |

**Why this matters:**
- **No "checks" anti-pattern.** The client submits proofs (a password value, an OTP code, a passkey assertion). The server verifies, updates factors, and re-evaluates the assurance level.
- **No binary "sufficient".** A session at AAL2 satisfies one RP but not another requiring AAL3. The session reports its level; the request context determines if it's enough.
- Step-up auth works naturally: the RP requests a higher ACR → the session adds factors → the level rises.

## Assurance Levels and ACR

The session model is built around **Authentication Context Class Reference (ACR)** from OpenID Connect and **Authenticator Assurance Levels (AAL)** from NIST SP 800-63.

### Core Concepts

| Concept | What it means |
|---|---|
| **ACR** (Authentication Context Class Reference) | A string representing the assurance level of an authentication event. Appears in OIDC ID tokens as the `acr` claim. |
| **AMR** (Authentication Methods References) | List of method identifiers used during authentication (e.g., `["pwd", "otp", "mfa"]`). Appears in OIDC ID tokens as the `amr` claim. |
| **AAL** (Authenticator Assurance Level) | NIST's classification: AAL1 (single factor), AAL2 (two factors), AAL3 (hardware + phishing-resistant). |

### How It Works

1. The session **accumulates factors** — each with `verified_at` timestamp and authenticator properties.
2. The policy engine **defines ACR levels as JSON Schema** — each level specifies which factors are required, their combination logic, and freshness constraints.
3. The session's current `acr` is the **highest level whose schema the factors satisfy right now**.
4. Whether that level is "enough" depends on the **request context** (`acr_values`, application policy, action sensitivity).

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
- The session's `acr` **degrades over time** without the session itself expiring.
- Step-up re-authentication refreshes the factor's `verified_at`, restoring the higher level.

### Factor Freshness in Practice

```
Session factors:
  user:     { verified_at: "2026-04-17T08:00:00Z" }
  password: { verified_at: "2026-04-17T08:00:00Z" }
  totp:     { verified_at: "2026-04-17T08:01:00Z" }

Current time: 2026-04-17T14:00:00Z (6h later)

AAL2 schema requires: totp.verified_at within 4h
TOTP verified 6h ago → FAILS freshness check

Current ACR: urn:zitadel:aal:1 (password still fresh within 24h)
```

The session is still valid. An RP requesting AAL1 succeeds. An RP requesting AAL2 triggers step-up: "submit a fresh second factor."

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

## Endpoints

```
POST   /sessions                     Create session
GET    /sessions/{id}                Get session state + factors + acr
PATCH  /sessions/{id}                Submit factor proofs
DELETE /sessions/{id}                Revoke session

POST   /sessions/{id}/challenge      Request challenge (passkey, OTP, captcha)
GET    /sessions                      List sessions
```

## Session Lifecycle

```
                  ┌──────────┐
  CreateSession → │ building │ ← step-up adds factors
                  └────┬─────┘
                       │ has at least one auth factor
                       ▼
                  ┌──────────┐
                  │  active  │ ← acr may degrade as factors age
                  └────┬─────┘
                  ┌────┴─────┐
                  ▼          ▼
            ┌─────────┐ ┌─────────┐
            │ expired │ │ revoked │
            └─────────┘ └─────────┘
```

A session transitions to `active` when it has at least one verified authentication factor (beyond just user identification). But `active` does not mean "enough for all purposes" — the session's `acr` determines what it can be used for in each context.

## Submit Factor Proofs

The client submits **proofs** — raw credentials or assertions. The server verifies them and updates the session's factors. The client never tells the server _what_ to check.

Proof fields are top-level keys on the PATCH body, not nested under a wrapper. Multiple proofs can be submitted in a single request.

```http
PATCH /sessions/sess_abc
{
  "session_token": "tok_xyz",
  "user": { "login_name": "alice@acme.com" }
}
```

```json
{
  "session_token": "tok_xyz2",
  "state": "building",
  "factors": {
    "user": { "user_id": "u_123", "verified_at": "2026-04-17T10:00:00Z" }
  },
  "acr": null,
  "amr": [],
  "need": ["password", "passkey"]
}
```

### After Password + OTP

```http
PATCH /sessions/sess_abc
{
  "session_token": "tok_xyz3",
  "otp": { "code": "123456" }
}
```

```json
{
  "session_token": "tok_final",
  "state": "active",
  "factors": {
    "user":     { "user_id": "u_123", "verified_at": "2026-04-17T10:00:00Z" },
    "password": { "verified_at": "2026-04-17T10:01:00Z" },
    "otp":      { "verified_at": "2026-04-17T10:02:00Z" }
  },
  "acr": "urn:zitadel:aal:2",
  "amr": ["pwd", "otp", "mfa"],
  "need": []
}
```

The session is now at AAL2. An OIDC token exchange requesting `acr_values=urn:zitadel:aal:2` would succeed. A request requiring AAL3 would fail — the client would need to add a hardware-based factor.

### Step-Up Authentication

A user has an active session at AAL1 (password only). An RP requests AAL2:

```
RP → /authorize?acr_values=urn:zitadel:aal:2
IdP checks session: acr = urn:zitadel:aal:1
IdP: "need a second factor" → prompts for TOTP/passkey
User submits TOTP → session factors updated → acr = urn:zitadel:aal:2
IdP issues ID token with acr: "urn:zitadel:aal:2"
```

The same session is used. No new session is created. The factors accumulate.

### Factor Freshness Triggers Step-Up

```
RP → /authorize?acr_values=urn:zitadel:aal:2&max_age=300
IdP checks session:
  - password: verified 2h ago (within 24h limit → OK)
  - totp: verified 5h ago (exceeds 4h freshness → STALE)
  - effective acr: urn:zitadel:aal:1

IdP: "TOTP is stale, need a fresh second factor"
User submits fresh TOTP → totp.verified_at updated → acr = urn:zitadel:aal:2
```

## Context-Specific Evaluation

The session stores factors and exposes its current `acr`. But whether that `acr` is "enough" is determined by the **request context**:

| Context | Who decides | How |
|---|---|---|
| OIDC auth request | RP via `acr_values` or `claims` parameter | IdP compares session `acr` against requested values |
| Resource server (step-up) | RS via `WWW-Authenticate` header (RFC 9470) | Client re-authorizes with `acr_values` |
| Flow engine | Policy engine per step | `policy_check` step evaluates session `acr` against step requirements |
| Admin console action | Policy per action sensitivity | "Delete team" requires AAL3; "view settings" requires AAL1 |

The session itself never says "I am sufficient." It says "I am at this level." The consumer decides if that level is enough.

## The `need` Array

For convenience, the session returns `need` — factor types that would raise the assurance level. This is always relative to the **next achievable level** above the current one, unless a specific target was requested.

```json
"acr": "urn:zitadel:aal:1",
"need": ["totp", "passkey", "otp_sms"]
```

Meaning: "You're at AAL1. Any of these would get you to AAL2."

When evaluated in the context of an OIDC request with a specific `acr_values`, `need` reflects what's needed to reach that specific target:

```json
"acr": "urn:zitadel:aal:1",
"requested_acr": "urn:zitadel:aal:3",
"need": ["passkey"]
```

Meaning: "AAL3 requires a phishing-resistant hardware authenticator. Submit a passkey assertion."

When a factor has aged out, `need` can include factors the session already has — meaning "re-verify this factor":

```json
"acr": "urn:zitadel:aal:1",
"requested_acr": "urn:zitadel:aal:2",
"need": ["totp", "otp_sms"],
"stale": ["totp"]
```

## Supported Factor Types

| Factor | Proof payload | Requires | AAL contribution |
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
    acr             TEXT,                        -- current assurance level (computed on every mutation)
    amr             TEXT[]      DEFAULT '{}',   -- authentication methods used
    need            TEXT[]      DEFAULT '{}',   -- factor types that would raise acr
    metadata        JSONB       NOT NULL DEFAULT '{}',
    user_agent      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,

    PRIMARY KEY (project_id, id)
);
```
