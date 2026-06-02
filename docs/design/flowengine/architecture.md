# Flow Engine — Architecture

> **Status:** Current
> **See also:** [Flow Engine](flow-engine.md) · [Definition Rules](flow-definition-rules.md) · [Capabilities](capabilities.md) · [Storage](flow-engine-storage.md)

This document maps the flow engine to the code that runs it: the components
that live inside the engine, the boundary code that drives it, and the
collaborators it calls into.

## Component map

```mermaid
graph TD
    OpenAPI["api/openapi/<br>OpenAPI spec"]
    Handler["internal/api/flow.go<br>HTTP handler"]
    Crypter["internal/crypto<br>Crypter (seal/unseal cookie)"]
    Service["internal/service/flow.go<br>FlowService"]
    SM["internal/domain/flow_state_machine.go<br>FlowStateMachineRuntime"]
    FR["internal/domain/flow_field_resolver*<br>FlowFieldResolver"]
    OS["internal/domain/flow_on_success*<br>FlowOnSuccessHandler"]
    AA["internal/domain/flow_auth_attempt.go<br>FlowAuthAttemptService"]

    AAImpl["service: auth-attempt"]
    Repo["repository: flow_definitions"]
    UserRepo["repository: users / passwords"]
    Schema["service: SchemaService"]

    OpenAPI --> Handler
    Handler --> Crypter
    Handler --> Service
    Service --> SM
    SM --> FR
    SM --> OS
    SM --> AA
    Service --> Repo
    FR --> Schema
    OS --> UserRepo
    AA --> AAImpl
```

## Request path

```
POST /flow                    GET /flow/{id}                POST /flow/{id}/submit
       │                              │                              │
       ▼                              ▼                              ▼
 Handler.CreateFlow         Handler.GetFlowStep         Handler.SubmitFlowStep
       │                              │                              │
       │     (no cookie yet)          ▼ openState(_zflow)             ▼ openState(_zflow)
       ▼                       Crypter.Decrypt                Crypter.Decrypt
 FlowService.Resolve                  │                              │
 FlowService.Start                    ▼                              ▼
       │                       FlowService.GetStep          FlowService.Submit
       ▼                              │                              │
 stateMachine.Start                   ▼                              ▼
       │                       stateMachine.Render          stateMachine.Process
       ▼                              │                              │
 sealState → Set-Cookie               └─── buildFlowResponse ◄────────┘
```

Cookie I/O is owned by the handler. The state machine never touches HTTP, cookies, or the encryption layer — it receives a `*FlowState` and returns one.

## Internal components

The components below all live under `internal/domain/` and `internal/service/`.

### `FlowService` (`internal/service/flow.go`)

The use-case surface the HTTP handler depends on. Four methods:

| Method | Responsibility |
|---|---|
| `Resolve` | Pick the active `FlowDefinition` to run. `Name` → direct lookup; otherwise audience-based (`Hint` plumbed through but not yet honored). |
| `Start` | Mint a fresh `FlowState`, ask the state machine to bootstrap it, mint and attach `flow_*` and `sess_*` ids. |
| `Submit` | Re-fetch the definition from `state.DefinitionID`, hand to `stateMachine.Process`. |
| `GetStep` | Re-fetch the definition, hand to `stateMachine.Render` (no advancement). |

Service holds the database `Pool`, the `FlowDefinitionRepository`, the `FlowStateMachine` interface, and the `idgen.Generator`. Each call passes the pool down — the state machine and resolvers receive a `database.QueryExecutor` per call.

### `FlowStateMachineRuntime` (`internal/domain/flow_state_machine.go`)

The state machine. Three entry points (`Start`, `Process`, `Render`) and one private pipeline:

```
Process(in):
  ├── find current step in definition
  ├── resolve fields via FlowFieldResolver
  ├── validate submitted values
  │     └─ on error: return same step with Error set
  ├── merge fields into state.CollectedData
  ├── dispatchChallenges (identifier, then password)
  │     ├─ verify-vs-skip keyed on state.CurrentPurpose + visited on_success
  │     ├─ on user_not_found / user_already_exists: route via outcome
  │     │   (and flip CurrentPurpose per the engine's flip rule)
  │     └─ on password reject: return same step with Error set
  ├── if step.OnSuccess set: run handler (create_user today)
  ├── look up routeOutcome in step.Transitions
  ├── advance state (push to history, set CurrentStep)
  └── if next step is terminal:
        ├── render terminal step
        └── if a user was resolved: authAttempts.Handoff → token + expiry
```

Errors that surface from `Process`:

- `ErrInvalidAction` — submitted action not in the step's `Transitions`.
- `ErrIntegrity` — wiring contract violated (missing definition, missing step, missing dependency).
- `ErrUnsupported` — feature deferred (cross-flow transitions, SSO submissions, gate proofs).
- `ErrSessionConflict` — reserved; not emitted today.

### `FlowFieldResolver` (`internal/domain/flow_field_resolver*.go`)

Interface (`Resolve` + `Validate`) plus a schema-backed implementation in `flow_field_resolver_schema.go`. Given a user schema URL and a list of property names, it returns:

- `FlowField` per property — UI input `Type`, `TextKey`, `Required`, optional `Validation`, the field's uniqueness scope, and the `FlowFieldChallenge` it maps to (derived from `x-unique` and `x-password` annotations).
- `ImplicitOutcomes` per field — the engine-emitted routing outcomes the field contributes (today: `user_not_found` and `user_already_exists` from identifier-shaped fields).

`Validate` walks the resolved fields and returns `FlowFieldValidationErrors` on rule violations — the state machine surfaces those as step errors.

### `FlowOnSuccessHandler` (`internal/domain/flow_on_success.go`)

Interface every `on_success` mutation satisfies. One implementation today:

- `FlowCreateUserHandler` (`flow_on_success_create_user.go`) — reads the identifier and password fields from the submission, hashes the password via `FlowPasswordHasher`, writes the user via the user repository, writes the credential via the password repository. Returns the resolved `UserID` so the state machine can stash it on `CollectedData[_user_id]`.

### `FlowAuthAttemptService` (`internal/domain/flow_auth_attempt.go`)

A narrow interface over the auth-attempt service. The state machine sees four
methods (`Start`, `SubmitIdentifier`, `SubmitPassword`, `Handoff`) and never
sees challenge ids. Identifier no-match and password rejection both surface as
`ErrAuthAttemptProofRejected`, which the state machine routes (`user_not_found`)
or re-renders (step error) accordingly.

### Domain types worth knowing

- `FlowDefinition` / `FlowDefinitionStep` — the immutable graph (`flow_definition.go`). Steps don't have a `type`; behavior derives from `Fields`, `Actions`, `Gates`, `SSOProviders`, `OnSuccess`, `Complete`, and `Transitions`.
- `FlowState` / `FlowProgress` — the cookie payload (`flow_state.go`). `FlowState` wraps `FlowProgress` (current step, history, collected data, `Purpose`, and the dispatch-mode `CurrentPurpose`) and adds session/OIDC context plus a reserved `PivotStack`.
- `FlowStep` — the capability payload returned to the client (`flow_state_machine.go`).
- Reserved key `FlowCollectedUserIDKey` (`_user_id`) — where on-success handlers stash the resolved user id.

## Upstream dependencies (what calls into the engine)

### HTTP handler — `internal/api/flow.go`

Implements three ogen-generated method signatures: `CreateFlow`, `SubmitFlowStep`, `GetFlowStep`. The handler:

- Decodes ogen request types into `service.*Request` shapes.
- Calls `FlowService`.
- Seals the returned `*FlowState` into the `_zflow` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age=600`).
- Translates `service.FlowStepResult` into the OpenAPI `FlowResponse` (`toFlowStep`, `toFlowField`, `toFlowStepActions`).
- Maps domain errors to HTTP status codes (`mapFlowErrorStatus`, `mapFlowGetError`).

Cookie semantics:

| Sentinel | HTTP code | Cookie response |
|---|---|---|
| `errFlowCookieMissing` / `errFlowCookieInvalid` | 401 | none |
| `errFlowCookieExpired` | 401 | none |
| `errFlowIDMismatch` | 404 | none |
| `errFlowCompleted` (GET only) | 410 | none |
| Validation step error | 400 | rotated cookie |
| Terminal step | 200 | cleared cookie (`Max-Age=0`) |
| Advancing step | 200 | rotated cookie |

### Cookie sealer — `internal/crypto.Crypter`

Interface with `Encrypt(string) (string, error)` and `Decrypt(string) (string, error)`. Wired into `Handler.crypter` at construction. The handler's `sealState` / `openState` helpers wrap JSON encoding around it. Max-age expiration is enforced separately by comparing `state.IssuedAt` against `flowCookieMaxAgeSeconds`.

### OpenAPI spec — `api/openapi/`

Source of truth for the wire format. The ogen-generated types under `api/generated/` are what the handler receives and returns. The relevant schemas live in `api/openapi/components/flows/`. Changing a request or response shape starts here.

## Downstream dependencies (what the engine calls)

### auth-attempt service

Wired in as `FlowAuthAttemptService`. The state machine calls `Start` at `FlowService.Start`, `SubmitIdentifier` and `SubmitPassword` from `dispatchChallenges`, and `Handoff` at the terminal step when a user has been resolved. Today the production implementation is the `AuthAttemptService` in `internal/service/auth_attempt.go`.

### `FlowDefinitionRepository`

`internal/storage/database/repository/flow_definition.go`. Backs `FlowService.Resolve` (list active definitions) and `FlowService.Submit` / `GetStep` (re-fetch by id). Postgres and Spanner migrations both ship `000005_flow_definitions.sql`.

### User writers

`FlowCreateUserHandler` depends on a narrow `flowUserWriter` (`Create`) and `flowUserPasswordWriter` (`Create`). Today the user repository (`internal/storage/database/repository/user.go`) and password repository satisfy these interfaces — the handler itself is repo-agnostic.

### Password hasher

`FlowPasswordHasher` (`internal/domain/flow_on_success.go`). The runtime implementation lives in `internal/crypto/` and is injected at wiring time.

### Schema service

Backs the schema-driven `FlowFieldResolver` implementation. Reads the user schema referenced by `FlowDefinition.UserSchema` and translates JSON Schema + `x-*` annotations into `FlowField` and `ImplicitOutcomes`.

### ID generator

`internal/domain/idgen.Generator`. The service mints `flow_*` ids at `Start`; the auth-attempt adapter mints `att_*`; the create-user handler mints `user_*`.

## Where to read next

- [`flow-engine.md`](flow-engine.md) — design-level overview of definitions, resolution, and capabilities.
- [`flow-definition-rules.md`](flow-definition-rules.md) — definition shape and validation rules.
- [`capabilities.md`](capabilities.md) — what works today, what's stubbed, what's missing.
- [`flow-engine-storage.md`](flow-engine-storage.md) — why the cookie, why the DB stays quiet between submits.
