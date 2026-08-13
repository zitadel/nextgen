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
  "project_id": "proj_01hexample",
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
| `project_id` | Required — which project's flow definitions to resolve against |
| `purpose` | What the flow achieves: `login`, `register`, `recovery`, `profiling`, `reauth`, `link_account` |
| `auth_request_id` | Links to an OIDC/SAML auth request — determines target ACR and redirect |
| `redirect_uri` | Where to send the user on completion (from the auth request or explicit) |
| `hint.login_name` | Auto-submits identifier step (OIDC `login_hint`) |
| `hint.team_id` | Scopes flow resolution to a team |
| `hint.user_schema_id` | Scopes to a specific user type |
| `hint.app_id` | Scopes to a specific application |

### Flow Resolution

The server resolves which flow definition to use:

1. Filter active definitions whose `purposes` map has an entry for the requested purpose
2. Filter by audience match (app > team > project-wide)
3. Most specific wins; tie-break by priority
4. Enter at the step named by `purposes[<purpose>]` in the matched definition
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
- **`on_success`** — server-side mutation to run after the step's fields validate (`"create_user"` is the only shipped value). Executes before the transition fires.
- **`complete`** — marks the step as terminal (`"redirect"` or `"show"`).
- **`gates`** — object keyed by gate name; each gate declares `{ "kind": "captcha", "provider": … }`. The engine may also inject gates dynamically based on policy. Passkey is not a gate — authenticator ceremonies run as credential auth_attempts.

### Implicit Post-Submit Policy Evaluation

After every submit, the engine evaluates assurance policy automatically. If the session's `assurance_levels[]` satisfies the target ACR, the engine transitions to the `complete` step — no explicit policy check nodes needed. If additional factors are required, the engine follows the defined transitions or injects steps dynamically.

## Flow Completion

A step with `complete` set is the terminal state. The frontend knows the flow is done because `step.complete` is present.

```json
{
  "id": "flow_xyz",
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

> **Direction — not runtime-supported.** The definition schema accepts
> `switch`/`pivot` transitions and the validator admits them, but today's
> engine rejects every transition carrying a non-null `action` with
> `{ "code": "flow.unsupported" }` (`internal/domain/flow_state_machine.go`;
> tracked as stubbed in [capabilities.md](capabilities.md)). The shipped
> default flow moves between login and register inside a single definition
> using local re-purposing transitions instead
> (`{ "target": "register", "purpose": "register" }` — see
> [`packages/config/defaults/default-login.json`](../../../packages/config/defaults/default-login.json)).

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
  "name": "default-login",
  "status": "active",
  "user_schema": "sch_01hexample",
  "purposes": { "login": "login" },
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
{ "project_id": "proj_01hexample", "purpose": "login", "auth_request_id": "oidc-123", "redirect_uri": "https://app.com/cb" }
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
      {"name": "email", "type": "email", "text_key": "login.field.email", "required": true},
      {"name": "password", "type": "password", "text_key": "login.field.password", "required": true}
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
{ "session_token": "tok_1", "action": "submit", "fields": { "email": "alice@acme.com", "password": "correct-horse" } }
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
  "name": "default-register",
  "status": "active",
  "user_schema": "sch_01hexample",
  "purposes": { "register": "profile" },
  "steps": [
    {
      "name": "profile",
      "fields": ["email", "given_name", "family_name"],
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true},
        {"name": "login", "kind": "navigate"}
      ],
      "transitions": {
        "submit": { "target": "set-password" },
        "login": { "target": "default-login", "action": "switch" }
      }
    },
    {
      "name": "set-password",
      "fields": ["password"],
      "on_success": "create_user",
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
      "transitions": {
        "submit": { "target": "done" }
      }
    },
    { "name": "done", "complete": "show" }
  ]
}
```

**Frontend interaction (started from login via switch):**

User was on the login flow, clicked "Create account" — a `switch` transition
(direction-only today; see [Flow Pivot](#flow-pivot-cross-flow-navigation)):

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
      {"name": "email", "type": "email", "text_key": "profile.field.email", "required": true, "value": "alice@acme.com"},
      {"name": "given_name", "type": "text", "text_key": "profile.field.given_name", "required": true},
      {"name": "family_name", "type": "text", "text_key": "profile.field.family_name", "required": true}
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
{ "session_token": "tok_2", "action": "submit", "fields": { "email": "alice@acme.com", "given_name": "Alice", "family_name": "Smith" } }
```
```json
← 200
{
  "id": "flow_1",
  "session_id": "sess_1",
  "session_token": "tok_3",
  "step": {
    "name": "set-password",
    "fields": [
      {"name": "password", "type": "password", "text_key": "set-password.field.password", "required": true, "validation": { "min_length": 8 }}
    ],
    "actions": [
      {"name": "submit", "kind": "submit", "text_key": "set-password.action.submit", "primary": true}
    ],
    "gates": {}
  }
}
```

```http
POST /flow/flow_1/submit
{ "session_token": "tok_3", "action": "submit", "fields": { "password": "strong-pass-123!" } }
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
  "name": "combined-auth",
  "status": "active",
  "user_schema": "sch_01hexample",
  "purposes": { "login": "identify", "register": "identify" },
  "steps": [
    {
      "name": "identify",
      "fields": ["email"],
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
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
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
      "transitions": {
        "submit": { "target": "set-password" }
      }
    },
    {
      "name": "set-password",
      "fields": ["password"],
      "on_success": "create_user",
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
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

> **Direction:** SSO is stubbed in today's engine (`ErrUnsupported` — see
> [capabilities.md](capabilities.md)). The definition below validates against
> the shipped schema; the runtime exchange shows the intended ceremony.

**Flow Definition:**

```json
{
  "name": "sso-login",
  "status": "active",
  "user_schema": "sch_01hexample",
  "purposes": { "login": "login" },
  "steps": [
    {
      "name": "login",
      "fields": ["email"],
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
      "sso_providers": [
        { "id": "google", "name": "Google", "template": "google" },
        { "id": "entra", "name": "Microsoft", "template": "entraid" }
      ],
      "transitions": {
        "submit": { "target": "signin" },
        "user_not_found": { "target": "login" },
        "callback": { "target": "done" }
      }
    },
    {
      "name": "signin",
      "fields": ["password"],
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
      "transitions": {
        "submit": { "target": "done" }
      }
    },
    { "name": "done", "complete": "redirect" }
  ]
}
```

The author never writes a `transitions.sso` — the engine handles the reserved
`sso` action transparently (IdP redirect, code exchange, user resolution) and
fires `callback` on this step when the IdP returns.

**Frontend interaction:**

```http
POST /flow
{ "project_id": "proj_01hexample", "purpose": "login", "auth_request_id": "oidc-789" }
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
      {"name": "email", "type": "email", "text_key": "login.field.email", "required": true}
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
{ "session_token": "tok_1", "action": "sso", "sso_provider_id": "google" }
```
```json
← 200  (engine-emitted redirect step — not authored in the definition)
{
  "id": "flow_2",
  "session_id": "sess_2",
  "session_token": "tok_2",
  "step": {
    "name": "sso-redirect",
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
  "name": "protected-register",
  "status": "active",
  "user_schema": "sch_01hexample",
  "purposes": { "register": "profile" },
  "steps": [
    {
      "name": "profile",
      "fields": ["email", "given_name", "family_name"],
      "gates": { "captcha": { "kind": "captcha", "provider": "altcha" } },
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
      "transitions": {
        "submit": { "target": "set-password" }
      }
    },
    {
      "name": "set-password",
      "fields": ["password"],
      "on_success": "create_user",
      "actions": [
        {"name": "submit", "kind": "submit", "primary": true}
      ],
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
{ "session_token": "tok_2", "action": "submit", "fields": { "password": "wrong" } }
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
      {"name": "password", "type": "password", "text_key": "signin.field.password", "required": true}
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
