# Flow Engine

> **Status:** Draft
> **See also:** [Overview](README.md) · [Step Response Shape](flow-engine-nodes.md) · [Storage](flow-engine-storage.md) · [OpenAPI spec](api/flow-api.yaml) · [Glossary](../glossary.md) · [auth_attempts (primitives layer)](../api/authn-and-auth-flows.md)

The flow engine is a **server-side state machine** that produces BDUI (Backend-Driven UI). It decides *which step renders when* — the UI-orchestration layer. It does **not** hold authentication primitives; those live in [`auth_attempts`](../api/authn-and-auth-flows.md). A flow step that says "collect password" internally calls the auth_attempt challenge/verify primitives, but `/flows/{session_id}` remains the flow engine's session-scoped UI handle rather than an alias for `auth_attempt_id`.

It is used by web/frontend clients that want a ready-made login and registration experience. Clients that want full control skip the flow engine entirely and drive the auth_attempt primitives (and the Session API) directly.

## Endpoints

```
POST   /flows                        Start a flow (creates a session internally)
GET    /flows/{session_id}           Get current step (re-render)
POST   /flows/{session_id}/submit    Submit step data, advance state machine
POST   /flows/{session_id}/event     Client-side event (fingerprint, telemetry)
```

The `session_id` identifies which session the flow operates on. Flow state itself is stored in an encrypted cookie — see [Storage](flow-engine-storage.md).

## Starting a Flow

```http
POST /flows
{
  "purpose": "login",
  "auth_request_id": "oidc-123",
  "redirect_uri": "https://app.com/callback",
  "hint": {
    "login_name": "alice@acme.com",
    "team_id": "team_acme"
  }
}
```

| Field | Purpose |
|---|---|
| `purpose` | What the flow achieves: `login`, `register`, `recovery`, `profiling`, `reauth`, `link_account` |
| `auth_request_id` | Links to an OIDC/SAML auth request — determines target ACR and redirect |
| `redirect_uri` | Where to send the user on completion (from the auth request or explicit) |
| `hint.login_name` | Auto-submits identifier step (OIDC `login_hint`) |
| `hint.team_id` | Scopes flow resolution to a team |
| `hint.schema_id` | Scopes to a specific user type |
| `hint.app_id` | Scopes to a specific application |

### Flow Resolution

The server resolves which flow definition to use:

1. Filter active definitions where `purposes[]` includes the requested purpose
2. Filter by audience match (app > team > schema > project default)
3. Most specific wins; tie-break by priority
4. Select `initial_steps[purpose]` from the matched definition
5. Fallback: built-in default flow

## Flow Definitions

A flow definition is a directed graph of steps, managed as an API resource.

```
POST   /flow-definitions             Create
GET    /flow-definitions/{id}        Get
PATCH  /flow-definitions/{id}        Update
DELETE /flow-definitions/{id}        Delete
GET    /flow-definitions              List

POST   /flow-definitions/{id}/activate    Draft → Active
POST   /flow-definitions/{id}/archive     Active → Archived
POST   /flow-definitions/{id}/validate    Check for dead ends, missing transitions
POST   /flow-definitions/{id}/simulate    Dry-run with mock input
```

## Step Types

| Type | Renders UI? | What it does |
|---|---|---|
| `identifier` | Yes | Collect user identifier (email/phone/username) + offer SSO/passkey |
| `credential` | Yes | Verify an auth factor (password, OTP, passkey) |
| `form` | Yes | Collect fields from user schema (registration, profiling) |
| `verification` | Yes | Verify email/phone via code |
| `policy_check` | No | Invisible decision point — evaluates policy, picks a transition |
| `action` | No | Execute server-side logic (create user, link account, reset credential) |
| `consent` | Yes | Show terms/consent, accept/decline |
| `captcha` | Yes | Proof-of-work challenge |
| `redirect` | Briefly | External redirect (SSO provider) |
| `info` | Yes | Display information |
| `complete` | Yes | Terminal — flow is done |

## Flow Completion

The `complete` step is the terminal state. The frontend knows the flow is done because `step.type == "complete"`.

The response includes a `behavior` field telling the frontend what to do:

```json
{
  "session_id": "sess_xyz",
  "session_token": "tok_final",
  "step": {
    "name": "done",
    "type": "complete",
    "label": "Login successful",
    "behavior": "redirect"
  },
  "redirect_uri": "https://app.com/callback?code=auth_xyz&state=abc"
}
```

| `behavior` | Meaning | When |
|---|---|---|
| `redirect` | Frontend should navigate to `redirect_uri` immediately | Login/reauth with OIDC auth request |
| `show` | Display the `label`/`description` as a success screen | Registration without auth request, recovery |
| `continue` | Flow auto-pivots back to a pending purpose (e.g., back to login after registration) | Registration with pending `auth_request_id` |

When `behavior` is `continue`, the frontend calls `GET /flows/{session_id}` to get the next step (the flow has already auto-pivoted server-side).

### What triggers completion

| Purpose | Completion condition |
|---|---|
| `login` / `reauth` | `policy_check` confirms session `assurance_levels[]` meets the target (from `acr_values` or app default) |
| `register` | `action` step creates user + session; `policy_check` confirms |
| `recovery` | `action` step resets credential |
| `profiling` | `policy_check` confirms user has required fields |

## Flow Pivot (Cross-Purpose Navigation)

Users navigate between purposes (login ↔ register ↔ recovery) without losing context. The session persists.

When the frontend submits an action that maps to a **pivot transition**, the flow engine:
1. Resolves a flow definition for the target purpose (same audience context)
2. Updates flow state: new definition, new current step, purpose changes
3. Preserves: session, device context, collected data, `auth_request_id`, verified factors
4. Returns the first step of the new purpose

Pivot transitions are declared in the definition:

```json
{
  "name": "identifier",
  "type": "identifier",
  "transitions": {
    "submit": "check_user",
    "register": { "pivot": "register" },
    "recover": { "pivot": "recovery" }
  }
}
```

After registration completes with a pending `auth_request_id`, the flow auto-pivots back to login. Since the session now has factors, `policy_check` may transition straight to `complete`.

## Step Response Shape

See [Flow Engine — Step Response Shape](flow-engine-nodes.md) for options on how steps are structured. **This is an open decision** — the examples in this document use the `fields[]` + `actions[]` format (Option C) but the final shape is pending frontend feedback.

## Storage

See [Flow Engine — Storage](flow-engine-storage.md) for the encrypted cookie model, size analysis, and DB I/O breakdown.

---

## End-to-End Examples

### Example 1: Login with MFA (password + TOTP)

**Flow Definition:**

```json
{
  "id": "flow_default_login",
  "name": "Default Login",
  "purposes": ["login"],
  "initial_steps": { "login": "identifier" },
  "audience": {},
  "steps": [
    {
      "name": "identifier",
      "type": "identifier",
      "config": { "methods": ["email"] },
      "transitions": {
        "submit": "resolve_user",
        "register": { "pivot": "register" }
      }
    },
    {
      "name": "resolve_user",
      "type": "policy_check",
      "config": { "check": "resolve_user" },
      "transitions": {
        "found": "check_factors",
        "not_found": "identifier"
      }
    },
    {
      "name": "check_factors",
      "type": "policy_check",
      "config": { "check": "required_factors" },
      "transitions": {
        "password": "password",
        "passkey": "passkey",
        "acr_met": "done"
      }
    },
    {
      "name": "password",
      "type": "credential",
      "config": { "factor": "password" },
      "transitions": {
        "submit": "check_factors",
        "recover": { "pivot": "recovery" }
      }
    },
    {
      "name": "passkey",
      "type": "credential",
      "config": { "factor": "passkey" },
      "transitions": { "submit": "check_factors" }
    },
    {
      "name": "done",
      "type": "complete",
      "config": { "behavior": "redirect" }
    }
  ]
}
```

**Frontend interaction:**

```http
POST /flows
{ "purpose": "login", "auth_request_id": "oidc-123", "redirect_uri": "https://app.com/cb" }
```
```json
← 201
{
  "session_id": "sess_1",
  "session_token": "tok_1",
  "step": {
    "name": "identifier",
    "type": "identifier",
    "label": "Sign in",
    "fields": [
      { "name": "identifier", "label": "Email", "type": "email" }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Continue", "primary": true },
      { "kind": "link",   "name": "register", "label": "Create account" }
    ]
  }
}
```

```http
POST /flows/sess_1/submit
{ "session_token": "tok_1", "action": "submit", "data": { "identifier": "alice@acme.com" } }
```
```json
← 200  (resolve_user: found → check_factors: needs password)
{
  "session_id": "sess_1",
  "session_token": "tok_2",
  "step": {
    "name": "password",
    "type": "credential",
    "label": "Enter your password",
    "fields": [
      { "name": "password", "type": "password", "label": "Password" }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Sign in", "primary": true },
      { "kind": "link",   "name": "recover", "label": "Forgot password?" }
    ]
  }
}
```

```http
POST /flows/sess_1/submit
{ "session_token": "tok_2", "action": "submit", "data": { "password": "correct-horse" } }
```
```json
← 200  (check_factors: password verified, but policy requires AAL2 → needs OTP)
{
  "session_id": "sess_1",
  "session_token": "tok_3",
  "step": {
    "name": "otp",
    "type": "credential",
    "label": "Two-factor authentication",
    "description": "Enter the code from your authenticator app",
    "fields": [
      { "name": "code", "type": "text", "label": "Code", "validation": { "pattern": "^[0-9]{6}$" } }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Verify", "primary": true }
    ]
  }
}
```

Note: the `otp` step wasn't in the definition. The `check_factors` policy_check determined that TOTP is needed and the flow engine rendered a credential step for it. This is either a generic credential step or an injected step — the frontend doesn't need to know.

```http
POST /flows/sess_1/submit
{ "session_token": "tok_3", "action": "submit", "data": { "code": "482916" } }
```
```json
← 200  (check_factors: acr_met → complete)
{
  "session_id": "sess_1",
  "session_token": "tok_4",
  "step": {
    "name": "done",
    "type": "complete",
    "label": "Login successful",
    "behavior": "redirect"
  },
  "redirect_uri": "https://app.com/cb?code=authz_xyz&state=abc"
}
```

Frontend navigates to `redirect_uri`. Done.

---

### Example 2: Registration → Auto-Login

**Flow Definition:**

```json
{
  "id": "flow_default_register",
  "name": "Default Registration",
  "purposes": ["register"],
  "initial_steps": { "register": "profile" },
  "audience": {},
  "steps": [
    {
      "name": "profile",
      "type": "form",
      "config": { "schema": "human_user", "fields": ["email", "given_name", "family_name"] },
      "transitions": {
        "submit": "set_password",
        "login": { "pivot": "login" }
      }
    },
    {
      "name": "set_password",
      "type": "form",
      "config": { "schema": "human_user", "fields": ["password"] },
      "transitions": { "submit": "verify_email" }
    },
    {
      "name": "verify_email",
      "type": "verification",
      "config": { "method": "email", "field": "email" },
      "transitions": { "verified": "create_user" }
    },
    {
      "name": "create_user",
      "type": "action",
      "config": { "action": "create_user_and_session" },
      "transitions": { "created": "done" }
    },
    {
      "name": "done",
      "type": "complete",
      "config": { "behavior": "continue" }
    }
  ]
}
```

**Frontend interaction (started from login via pivot):**

User was on the login flow, clicked "Create account":

```http
POST /flows/sess_1/submit
{ "session_token": "tok_1", "action": "register" }
```
```json
← 200  (pivoted to registration flow, email carried over from identifier step)
{
  "session_id": "sess_1",
  "session_token": "tok_2",
  "step": {
    "name": "profile",
    "type": "form",
    "label": "Create your account",
    "fields": [
      { "name": "email",       "label": "Email",      "type": "email", "required": true, "value": "alice@acme.com" },
      { "name": "given_name",  "label": "First name", "type": "text",  "required": true },
      { "name": "family_name", "label": "Last name",  "type": "text",  "required": true }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Continue", "primary": true },
      { "kind": "link",   "name": "login",  "label": "Already have an account? Sign in" }
    ]
  }
}
```

Note: `email` is pre-filled from the data collected during the login flow's identifier step.

```http
POST /flows/sess_1/submit
{ "session_token": "tok_2", "action": "submit", "data": { "email": "alice@acme.com", "given_name": "Alice", "family_name": "Smith" } }
```
```json
← 200
{
  "session_id": "sess_1",
  "session_token": "tok_3",
  "step": {
    "name": "set_password",
    "type": "form",
    "label": "Choose a password",
    "fields": [
      { "name": "password", "label": "Password", "type": "password", "required": true,
        "validation": { "min_length": 8 } }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Continue", "primary": true }
    ]
  }
}
```

```http
POST /flows/sess_1/submit
{ "session_token": "tok_3", "action": "submit", "data": { "password": "strong-pass-123!" } }
```
```json
← 200
{
  "session_id": "sess_1",
  "session_token": "tok_4",
  "step": {
    "name": "verify_email",
    "type": "verification",
    "label": "Verify your email",
    "description": "We sent a code to alice@acme.com",
    "fields": [
      { "name": "code", "label": "Verification code", "type": "text" }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Verify", "primary": true },
      { "kind": "submit", "name": "resend", "label": "Resend code" }
    ]
  }
}
```

```http
POST /flows/sess_1/submit
{ "session_token": "tok_4", "action": "submit", "data": { "code": "839201" } }
```
```json
← 200  (verified → create_user action runs → done with behavior: continue)
{
  "session_id": "sess_1",
  "session_token": "tok_5",
  "step": {
    "name": "done",
    "type": "complete",
    "label": "Account created",
    "behavior": "continue"
  }
}
```

Frontend sees `behavior: "continue"` — polls for the next step:

```http
GET /flows/sess_1
```
```json
← 200  (auto-pivoted back to login, policy_check found session already at AAL1 → complete)
{
  "session_id": "sess_1",
  "session_token": "tok_6",
  "step": {
    "name": "done",
    "type": "complete",
    "label": "Login successful",
    "behavior": "redirect"
  },
  "redirect_uri": "https://app.com/cb?code=authz_abc&state=xyz"
}
```

The user registered and logged in without entering credentials twice.

---

### Example 3: SSO Login (Google)

**Flow Definition** (same login flow, identifier step has SSO configured):

```json
{
  "name": "identifier",
  "type": "identifier",
  "config": {
    "methods": ["email"],
    "sso_providers": ["google", "entra"]
  },
  "transitions": {
    "submit": "resolve_user",
    "sso": "sso_redirect",
    "register": { "pivot": "register" }
  }
}
```

**Frontend interaction:**

```http
POST /flows
{ "purpose": "login", "auth_request_id": "oidc-789" }
```
```json
← 201
{
  "session_id": "sess_2",
  "session_token": "tok_1",
  "step": {
    "name": "identifier",
    "type": "identifier",
    "label": "Sign in",
    "fields": [
      { "name": "identifier", "label": "Email", "type": "email" }
    ],
    "actions": [
      { "kind": "submit",  "name": "submit",  "label": "Continue", "primary": true },
      { "kind": "sso",     "name": "google",  "label": "Continue with Google", "provider": "google" },
      { "kind": "sso",     "name": "entra",   "label": "Continue with Microsoft", "provider": "entra" },
      { "kind": "link",    "name": "register", "label": "Create account" }
    ]
  }
}
```

User clicks "Continue with Google":

```http
POST /flows/sess_2/submit
{ "session_token": "tok_1", "action": "google" }
```
```json
← 200
{
  "session_id": "sess_2",
  "session_token": "tok_2",
  "step": {
    "name": "sso_redirect",
    "type": "redirect",
    "label": "Redirecting to Google...",
    "redirect_url": "https://accounts.google.com/o/oauth2/auth?client_id=...&state=sess_2_google"
  }
}
```

Frontend navigates to `redirect_url`. Google authenticates, redirects back to Zitadel callback. Zitadel processes the callback, updates the session with an `idp` factor, then evaluates policy:

```http
GET /flows/sess_2
```
```json
← 200  (SSO callback processed → policy_check: acr_met → complete)
{
  "session_id": "sess_2",
  "session_token": "tok_3",
  "step": {
    "name": "done",
    "type": "complete",
    "label": "Login successful",
    "behavior": "redirect"
  },
  "redirect_uri": "https://app.com/cb?code=authz_sso&state=def"
}
```

---

### Example 4: Step-Up (Active Session, Higher ACR Requested)

User already has an active session at AAL1. An RP requests AAL2.

```http
POST /flows
{ "purpose": "reauth", "auth_request_id": "oidc-stepup" }
```
```json
← 201  (session already has user + password, but stale. Policy needs fresh second factor.)
{
  "session_id": "sess_existing",
  "session_token": "tok_1",
  "step": {
    "name": "otp",
    "type": "credential",
    "label": "Verify your identity",
    "description": "This action requires additional verification",
    "fields": [
      { "name": "code", "type": "text", "label": "Authenticator code", "validation": { "pattern": "^[0-9]{6}$" } }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Verify", "primary": true }
    ]
  }
}
```

The flow skipped identifier and password — the session already has those factors. It jumped straight to what's missing.

```http
POST /flows/sess_existing/submit
{ "session_token": "tok_1", "action": "submit", "data": { "code": "159263" } }
```
```json
← 200
{
  "session_id": "sess_existing",
  "session_token": "tok_2",
  "step": {
    "name": "done",
    "type": "complete",
    "label": "Verification complete",
    "behavior": "redirect"
  },
  "redirect_uri": "https://app.com/sensitive-action?code=authz_step&state=ghi"
}
```

---

### Example 5: Password Recovery

```http
POST /flows/sess_1/submit
{ "session_token": "tok_2", "action": "recover" }
```
```json
← 200  (pivoted to recovery flow)
{
  "session_id": "sess_1",
  "session_token": "tok_3",
  "step": {
    "name": "recovery_email",
    "type": "verification",
    "label": "Reset your password",
    "description": "We'll send a code to your email address",
    "fields": [
      { "name": "email", "label": "Email", "type": "email", "value": "alice@acme.com" }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Send code", "primary": true },
      { "kind": "link",   "name": "back",   "label": "Back to sign in" }
    ]
  }
}
```

```http
POST /flows/sess_1/submit
{ "session_token": "tok_3", "action": "submit", "data": { "email": "alice@acme.com" } }
```
```json
← 200
{
  "session_id": "sess_1",
  "session_token": "tok_4",
  "step": {
    "name": "verify_code",
    "type": "verification",
    "label": "Enter your code",
    "description": "Check your inbox for a verification code",
    "fields": [
      { "name": "code", "label": "Code", "type": "text" }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Verify", "primary": true },
      { "kind": "submit", "name": "resend", "label": "Resend code" }
    ]
  }
}
```

```http
POST /flows/sess_1/submit
{ "session_token": "tok_4", "action": "submit", "data": { "code": "482916" } }
```
```json
← 200
{
  "session_id": "sess_1",
  "session_token": "tok_5",
  "step": {
    "name": "new_password",
    "type": "form",
    "label": "Set a new password",
    "fields": [
      { "name": "password", "label": "New password", "type": "password", "required": true, "validation": { "min_length": 8 } }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Reset password", "primary": true }
    ]
  }
}
```

```http
POST /flows/sess_1/submit
{ "session_token": "tok_5", "action": "submit", "data": { "password": "new-strong-pass!" } }
```
```json
← 200  (action resets password → pivots back to login since auth_request_id pending)
{
  "session_id": "sess_1",
  "session_token": "tok_6",
  "step": {
    "name": "done",
    "type": "complete",
    "label": "Password reset successful",
    "behavior": "continue"
  }
}
```

```http
GET /flows/sess_1
```
```json
← 200  (back in login flow, password factor now fresh → may need to re-enter or policy_check passes)
{
  "session_id": "sess_1",
  "session_token": "tok_7",
  "step": {
    "name": "password",
    "type": "credential",
    "label": "Sign in with your new password",
    "fields": [
      { "name": "password", "type": "password", "label": "Password" }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Sign in", "primary": true }
    ]
  }
}
```

---

### Error Handling

When a submission fails validation or proof verification, the flow does **not** advance. The same step is returned with an `error` field:

```http
POST /flows/sess_1/submit
{ "session_token": "tok_2", "action": "submit", "data": { "password": "wrong" } }
```
```json
← 400
{
  "session_id": "sess_1",
  "session_token": "tok_2b",
  "step": {
    "name": "password",
    "type": "credential",
    "label": "Enter your password",
    "error": "Invalid password. 2 attempts remaining.",
    "fields": [
      { "name": "password", "type": "password", "label": "Password" }
    ],
    "actions": [
      { "kind": "submit", "name": "submit", "label": "Sign in", "primary": true },
      { "kind": "link",   "name": "recover", "label": "Forgot password?" }
    ]
  }
}
```

The token still rotates (prevents replay). The step stays the same. The frontend re-renders with the error message.
