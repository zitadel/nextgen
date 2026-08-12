# Flow Engine

> **Status:** Draft
> **See also:** [Overview](README.md) · [Step Response Shape](flow-engine-nodes.md) · [Storage](flow-engine-storage.md)
>
> **Canonical OpenAPI spec:** [`api/openapi/openapi-spec.yaml`](../../../api/openapi/openapi-spec.yaml) — endpoints under `/flow`. Schemas in [`api/openapi/components/flows/`](../../../api/openapi/components/flows/).

The flow engine is a **server-side state machine** that produces **Capability payloads** (semantic descriptions of fields, actions, and gates) alongside a **LiquidJS template** for rendering. It does **not** hold authentication primitives; those live in [`auth_attempts`](../api/authn-and-auth-flows.md). A flow step that says "collect password" internally invokes the auth_attempt **Go service layer** (never via HTTP), but the `/flow/{id}` handle remains the flow engine's session-scoped UI handle rather than an alias for `auth_attempt_id`.

It is used by web/frontend clients that want a ready-made login and registration experience. Clients that want full control skip the flow engine entirely and drive the auth_attempt primitives (and the Session API) directly.

## Endpoints

```
POST   /flow              Start a flow (creates a session internally)
GET    /flow/{id}          Get current step (re-render)
POST   /flow/{id}/submit   Submit step data, advance state machine
```

The `{id}` is a flow handle returned by `POST /flow` or the latest `POST /flow/{id}/submit`. It may change between responses on pivot or pop — the frontend must always use the `id` from the latest response. The underlying `session_id` remains stable across stacked flows. Flow state itself is stored in an encrypted cookie — see [Storage](flow-engine-storage.md).

## Starting a Flow

```http
POST /flow
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

A flow definition is a directed graph of steps, managed as an API resource. Each definition references a **user schema** via `user_schema` — step fields are property names from that schema, and the engine resolves field metadata (type, validation, implicit outcomes) from schema annotations at runtime.

```
POST   /flow_definitions             Create
GET    /flow_definitions             List
GET    /flow_definitions/{id}        Get
PUT    /flow_definitions/{id}        Update (full replacement)
DELETE /flow_definitions/{id}        Delete

# planned (not in the shipped spec):
POST   /flow_definitions/{id}/validate    Check for dead ends, missing transitions
POST   /flow_definitions/{id}/simulate    Dry-run with mock input
```

## Schema-Driven Steps

Steps do not have a `type`. Instead, the engine derives behavior from the step's properties:

- **`fields`** — array of schema property names. The engine resolves each field's type, validation, and implicit outcomes from the user schema's `x-*` annotations. For example, a field with a non-empty `x-unique` scope is an identifier and implies a `user_not_found` outcome in transitions.
- **`action`** — server-side mutation to run after the step succeeds (e.g. `"create_user"`). Executes before the transition fires.
- **`complete`** — marks the step as terminal (`"redirect"` or `"show"`).
- **`gates`** — array of gate types (`"captcha"`, `"passkey"`) required before submission. The engine may also inject gates dynamically based on policy.

### Implicit Post-Submit Policy Evaluation

After every submit, the engine evaluates assurance policy automatically. If the session's `assurance_levels[]` satisfies the target ACR, the engine transitions to the `complete` step — no explicit policy check nodes needed. If additional factors are required, the engine follows the defined transitions or injects steps dynamically.

## Flow Completion

A step with `complete` set is the terminal state. The frontend knows the flow is done because `step.complete` is present.

```json
{
  "session_id": "sess_xyz",
  "session_token": "tok_final",
  "step": {
    "name": "done",
    "complete": "redirect"
  },
  "redirect_uri": "https://app.com/callback?code=auth_xyz&state=abc"
}
```

| `complete` | Meaning | When |
|---|---|---|
| `redirect` | Frontend should navigate to `redirect_uri` immediately | Login/reauth with OIDC auth request |
| `show` | Display as a success screen | Registration without auth request, recovery |

When the flow completes after a pivot (e.g., registration with a pending `auth_request_id`), the engine auto-pops back to the parent flow. If the session now meets the target ACR, it transitions straight to `complete`.

### What triggers completion

| Purpose | Completion condition |
|---|---|
| `login` / `reauth` | Session `assurance_levels[]` includes the target ACR (implicit policy evaluation) |
| `register` | `on_success: "create_user"` creates user + session; implicit policy check passes |
| `recovery` | `on_success: "reset_credential"` resets the credential |
| `profiling` | User has required schema fields filled |

## Flow Pivot (Cross-Flow Navigation)

Users navigate between flows (login ↔ register ↔ recovery) without losing context. The session persists.

Transitions with `"action": "pivot"` push a new flow onto the stack. Transitions with `"action": "switch"` replace the current flow entirely.

```json
{
  "name": "login",
  "fields": ["email", "password"],
  "actions": [
    {"name": "submit", "kind": "submit", "primary": true},
    {"name": "register", "kind": "navigate"},
    {"name": "recover", "kind": "navigate"}
  ],
  "transitions": {
    "submit": { "target": "done" },
    "register": { "target": "default-register", "action": "switch" },
    "recover": { "target": "default-recovery", "action": "pivot" }
  }
}
```

After a pivoted flow completes, the engine auto-pops back to the parent. Since the session now has additional factors, implicit policy evaluation may skip straight to `complete`.

## Step Response Shape

See [Flow Engine — Step Response Shape](flow-engine-nodes.md) for the decided response structure. Steps emit **ordered capability arrays** for `fields` and `actions` (each entry carries a `name`; see [ADR 021](../../adrs/021-ordered-arrays-for-step-fields-actions-gates.md)) — the LiquidJS template iterates them and may look entries up by name (`where: "name"`). `gates` remains keyed.

## Storage

See [Flow Engine — Storage](flow-engine-storage.md) for the encrypted cookie model, size analysis, and DB I/O breakdown.

---

## End-to-End Examples

### Example 1: Simple Login (email + password)

**Flow Definition:**

```json
{
  "slug": "default-login",
  "name": "Default Login",
  "user_schema": "human_user",
  "purposes": ["login"],
  "initial_steps": { "login": "login" },
  "steps": [
    {
      "name": "login",
      "fields": ["email", "password"],
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true},
        {"name": "register", "kind": "navigate"},
        {"name": "recover", "kind": "navigate"}
      ],
      "transitions": {
        "submit": { "target": "done" },
        "register": { "target": "default-register", "action": "switch" },
        "recover": { "target": "default-recovery", "action": "pivot" }
      }
    },
    { "name": "done", "complete": "redirect" }
  ]
}
```

**Frontend interaction:**

```http
POST /flow
{ "purpose": "login", "auth_request_id": "oidc-123", "redirect_uri": "https://app.com/cb" }
```
```json
← 201
{
  "id": "flow_1",
  "session_id": "sess_1",
  "session_token": "tok_1",
  "step": {
    "name": "login",
    "fields": [
      {"name": "email", "kind": "navigate", "type": "email", "text_key": "login.field.email", "required": true},
      {"name": "password", "kind": "navigate", "type": "password", "text_key": "login.field.password", "required": true}
    ],
    "actions": [
      {"name": "submit", "kind": "submit", "text_key": "login.action.submit", "primary": true},
      {"name": "register", "kind": "navigate", "text_key": "login.action.register"},
      {"name": "recover", "kind": "navigate", "text_key": "login.action.recover"}
    ],
    "gates": {}
  }
}
```

```http
POST /flow/flow_1/submit
{ "session_token": "tok_1", "action": "submit", "data": { "email": "alice@acme.com", "password": "correct-horse" } }
```
```json
← 200  (implicit policy check: session has password factor, ACR met → complete)
{
  "id": "flow_1",
  "session_id": "sess_1",
  "session_token": "tok_2",
  "step": {
    "name": "done",
    "complete": "redirect"
  },
  "redirect_uri": "https://app.com/cb?code=authz_xyz&state=abc"
}
```

Frontend navigates to `redirect_uri`. Done.

If the policy requires MFA, the engine would instead respond with a dynamically injected step requesting the second factor before reaching `complete`.

---

### Example 2: Registration → Auto-Login

**Flow Definition:**

```json
{
  "slug": "default-register",
  "name": "Default Registration",
  "user_schema": "human_user",
  "purposes": ["register"],
  "initial_steps": { "register": "profile" },
  "steps": [
    {
      "name": "profile",
      "fields": ["email", "given_name", "family_name"],
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true},
        {"name": "login", "kind": "navigate"}
      ],
      "transitions": {
        "submit": { "target": "set_password" },
        "login": { "target": "default-login", "action": "switch" }
      }
    },
    {
      "name": "set_password",
      "fields": ["password"],
      "on_success": "create_user",
      "transitions": {
        "submit": { "target": "done" }
      }
    },
    { "name": "done", "complete": "show" }
  ]
}
```

**Frontend interaction (started from login via switch):**

User was on the login flow, clicked "Create account":

```http
POST /flow/flow_1/submit
{ "session_token": "tok_1", "action": "register" }
```
```json
← 200  (switched to registration flow, email carried over)
{
  "id": "flow_1",
  "session_id": "sess_1",
  "session_token": "tok_2",
  "step": {
    "name": "profile",
    "fields": [
      {"name": "email", "kind": "navigate", "type": "email", "text_key": "profile.field.email", "required": true, "value": "alice@acme.com"},
      {"name": "given_name", "kind": "navigate", "type": "text", "text_key": "profile.field.given_name", "required": true},
      {"name": "family_name", "kind": "navigate", "type": "text", "text_key": "profile.field.family_name", "required": true}
    ],
    "actions": [
      {"name": "submit", "kind": "submit", "text_key": "profile.action.submit", "primary": true},
      {"name": "login", "kind": "navigate", "text_key": "profile.action.login"}
    ],
    "gates": {}
  }
}
```

```http
POST /flow/flow_1/submit
{ "session_token": "tok_2", "action": "submit", "data": { "email": "alice@acme.com", "given_name": "Alice", "family_name": "Smith" } }
```
```json
← 200
{
  "id": "flow_1",
  "session_id": "sess_1",
  "session_token": "tok_3",
  "step": {
    "name": "set_password",
    "fields": [
      {"name": "password", "type": "password", "text_key": "set_password.field.password", "required": true, "validation": { "min_length": 8 }}
    ],
    "actions": [
      {"name": "submit", "kind": "submit", "text_key": "set_password.action.submit", "primary": true}
    ],
    "gates": {}
  }
}
```

```http
POST /flow/flow_1/submit
{ "session_token": "tok_3", "action": "submit", "data": { "password": "strong-pass-123!" } }
```
```json
← 200  (create_user action runs → done)
{
  "id": "flow_1",
  "session_id": "sess_1",
  "session_token": "tok_4",
  "step": {
    "name": "done",
    "complete": "show"
  }
}
```

If the registration was triggered during an OIDC auth request, the engine auto-pops back to the login flow. The session already has factors from registration, so implicit policy evaluation transitions straight to `complete` with `redirect`.

---

### Example 3: Combined Login + Registration (Single Flow)

A single flow that handles both login and registration using implicit outcomes from schema annotations.

**Flow Definition:**

```json
{
  "slug": "combined-auth",
  "name": "Combined Auth",
  "user_schema": "human_user",
  "purposes": ["login", "register"],
  "initial_steps": { "login": "identify", "register": "identify" },
  "steps": [
    {
      "name": "identify",
      "fields": ["email"],
      "transitions": {
        "submit": { "target": "signin" },
        "user_not_found": { "target": "profile" }
      }
    },
    {
      "name": "signin",
      "fields": ["password"],
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true},
        {"name": "recover", "kind": "navigate"}
      ],
      "transitions": {
        "submit": { "target": "done" },
        "recover": { "target": "default-recovery", "action": "pivot" }
      }
    },
    {
      "name": "profile",
      "fields": ["given_name", "family_name"],
      "transitions": {
        "submit": { "target": "set_password" }
      }
    },
    {
      "name": "set_password",
      "fields": ["password"],
      "on_success": "create_user",
      "transitions": {
        "submit": { "target": "done" }
      }
    },
    { "name": "done", "complete": "redirect" }
  ]
}
```

The `email` field has `x-unique: "project"` in the user schema, which makes it an identifier. When the user submits their email, the engine looks up the user. If found, it follows the `submit` transition to `signin`. If not found, it follows the `user_not_found` transition to `profile` (registration path).

---

### Example 4: SSO Login (Google)

**Flow Definition:**

```json
{
  "slug": "sso-login",
  "name": "SSO Login",
  "user_schema": "human_user",
  "purposes": ["login"],
  "initial_steps": { "login": "login" },
  "steps": [
    {
      "name": "login",
      "fields": ["email"],
      "sso_providers": [
        { "id": "google", "name": "Google" },
        { "id": "entra", "name": "Microsoft" }
      ],
      "transitions": {
        "submit": { "target": "signin" },
        "user_not_found": { "target": "login" },
        "sso": { "target": "sso_redirect" },
        "callback": { "target": "done" }
      }
    },
    {
      "name": "signin",
      "fields": ["password"],
      "transitions": {
        "submit": { "target": "done" }
      }
    },
    {
      "name": "sso_redirect",
      "transitions": {}
    },
    { "name": "done", "complete": "redirect" }
  ]
}
```

**Frontend interaction:**

```http
POST /flow
{ "purpose": "login", "auth_request_id": "oidc-789" }
```
```json
← 201
{
  "id": "flow_2",
  "session_id": "sess_2",
  "session_token": "tok_1",
  "step": {
    "name": "login",
    "fields": [
      {"name": "email", "kind": "navigate", "type": "email", "text_key": "login.field.email", "required": true}
    ],
    "actions": [
      {"name": "submit", "kind": "submit", "text_key": "login.action.submit", "primary": true}
    ],
    "gates": {},
    "sso_providers": [
      { "id": "google", "name": "Google" },
      { "id": "entra", "name": "Microsoft" }
    ]
  }
}
```

User clicks "Continue with Google":

```http
POST /flow/flow_2/submit
{ "session_token": "tok_1", "action": "google" }
```
```json
← 200
{
  "id": "flow_2",
  "session_id": "sess_2",
  "session_token": "tok_2",
  "step": {
    "name": "sso_redirect",
    "redirect_url": "https://accounts.google.com/o/oauth2/auth?client_id=...&state=sess_2_google"
  }
}
```

Frontend navigates to `redirect_url`. After Google callback, the engine processes it and evaluates policy:

```http
GET /flow/flow_2
```
```json
← 200  (SSO callback processed → implicit policy: ACR met → complete)
{
  "id": "flow_2",
  "session_id": "sess_2",
  "session_token": "tok_3",
  "step": {
    "name": "done",
    "complete": "redirect"
  },
  "redirect_uri": "https://app.com/cb?code=authz_sso&state=def"
}
```

---

### Example 5: Registration with Captcha

**Flow Definition:**

```json
{
  "slug": "protected-register",
  "name": "Protected Registration",
  "user_schema": "human_user",
  "purposes": ["register"],
  "initial_steps": { "register": "profile" },
  "steps": [
    {
      "name": "profile",
      "fields": ["email", "given_name", "family_name"],
      "gates": { "captcha": { "type": "captcha", "provider": "altcha" } },
      "transitions": {
        "submit": { "target": "set_password" }
      }
    },
    {
      "name": "set_password",
      "fields": ["password"],
      "on_success": "create_user",
      "transitions": {
        "submit": { "target": "done" }
      }
    },
    { "name": "done", "complete": "show" }
  ]
}
```

The `gates.captcha` on the profile step means the frontend must solve a captcha before submission, using the configured provider. The engine can also inject gates dynamically based on policy (e.g., risk score triggers captcha even if not declared in the definition).

---

### Error Handling

When a submission fails validation or proof verification, the flow does **not** advance. The same step is returned with an `error` field:

```http
POST /flow/flow_1/submit
{ "session_token": "tok_2", "action": "submit", "data": { "password": "wrong" } }
```
```json
← 400
{
  "id": "flow_1",
  "session_id": "sess_1",
  "session_token": "tok_2b",
  "step": {
    "name": "signin",
    "error": "Invalid password. 2 attempts remaining.",
    "fields": [
      {"name": "password", "kind": "navigate", "type": "password", "text_key": "signin.field.password", "required": true}
    ],
    "actions": [
      {"name": "submit", "kind": "submit", "text_key": "signin.action.submit", "primary": true},
      {"name": "recover", "kind": "navigate", "text_key": "signin.action.recover"}
    ],
    "gates": {}
  }
}
```

The token still rotates (prevents replay). The step stays the same. The frontend re-renders with the error message.
