# flowengine

The flow engine runs a flow definition: it starts a flow, processes each
submission, and renders the step the client shows next. It decides **how a
flow runs**; it does not do I/O of its own.

The design lives in [docs/design/flowengine](../../../../docs/design/flowengine/).

## Who does what

A request passes three layers:

```
internal/api          opens the sealed _zflow cookie, maps HTTP to service calls, seals the returned state
   │
internal/service      I/O: database reads, release pins, sessions, ids, spans, metrics, audit
   │
internal/flowengine   decisions: which step, which outcome, which ceremony, when the flow completes
```

| Concern | `flowengine` | `service` |
| --- | --- | --- |
| Entry definition | chooses among candidates (`EntryByName`, `EntryByAudience`) | reads the release pins and loads the candidates (`FlowService.Resolve`) |
| Start | builds the first `State` and step | resolves the user schema and session, mints the flow id, binds audit |
| Definitions during a flow | reads the one the state names (`ActiveDefinition`) | provides the lookup by id (`Definitions`) |
| Submission | validates, routes, runs actions and ceremonies | passes the request through |
| Auth attempts, users, SSO, password policy | calls them through interfaces it declares | implements those interfaces |
| Sign-up gate | announces it on the step (`SignupRequired`) | issues the proof-of-work puzzle on render |
| Completion | decides the flow is done and requests the handoff | mints the handoff token behind `AuthAttemptService` |
| Flow state | declares `State`, takes and returns it | never stores it; the API layer seals it into the cookie |
| Wiring | `New(Deps)` | `NewFlowEngine(FlowEngineDeps)` builds the engine and its collaborators |

Rules that keep the split:

- `flowengine` imports `domain`; `domain` never imports `flowengine`.
- Flow definitions and their validation belong to `domain`; the engine only reads them.
- A flow decision goes in `flowengine`, even if it needs data the service loads: the
  service loads it and passes it in.
- The engine never touches the database, the cookie or the HTTP request directly.

## Main components

### Runtime (`state_machine.go`)

`StateMachine` is the engine's public surface, and `Runtime` implements it:

- `Start`: begin a flow on its entry definition and render the first step.
- `Process`: apply one submission to the current step and return the next one.
- `Render`: re-emit the current step without advancing.

Each returns a `StepResult`: the new `State` and the `Step` the client shows.

### State (`state.go`)

`State` is everything a running flow remembers between requests: the
definition and step it is on, data collected so far, the back stack, a pending
ceremony, the auth attempt and the release it started under. It travels in the
sealed cookie, so the engine is stateless between requests.

### Definitions (`definition.go`, `entry_definition.go`)

`entry_definition.go` picks the definition a new flow starts on, by name or by
the best audience match. Once a flow runs, `ActiveDefinition` is the one way to
read its definition, through the `Definitions` lookup the service passes in.

### Actions (`action.go`, `action_<kind>.go`)

A submission names an action on the current step. `action.go` holds a table of
one handler per action kind (submit, back, navigate, passkey, passkey register),
and each handler lives in its own `action_<kind>.go`.

### Fields (`fields.go`)

Resolves a step's fields against the user schema, prefills them from collected
data, applies the password policy, and validates and merges submitted values
into the state.

### Routing (`routing.go`, `back.go`)

Turns an outcome into the next step: follows the definition's transitions,
flips the purpose (for example sign-in to sign-up when the user is unknown),
dispatches identifier challenges, and keeps the back stack. `back.go` advances
the state and records where back leads.

### Ceremonies (`challenge.go`, `passkey.go`, `sso.go`)

Two-phase proofs: the engine issues a challenge, the client answers, the
engine verifies. `challenge.go` holds a table of one declaration per method
and the shared issue and verify path; `passkey.go` supplies the passkey
parameters. `sso.go` runs the external identity provider round trip: redirect,
callback, account linking and conflicts.

### Outcomes (`on_success.go`)

What a step does when it succeeds, such as creating the user. A table holds
one handler per `on_success` value.

### Completion (`completion.go`)

Every route onto a terminal step goes through `completeFlow`, the only caller
of `Handoff`. An optional `CompletionPolicy` can refuse completion; nothing
wires one yet.

### Sign-up gate (`signup_gate.go`)

Marks a step `SignupRequired` when submitting it can create a user, so the
client solves the proof-of-work puzzle first.

### Rendering (`render.go`)

Builds the client-facing `Step` from the definition and the state: fields,
actions, identifier, pending challenge and errors.

## Interfaces the service implements

The engine declares what it needs; `service` implements it, and
`flowengine/mock` (package `flowenginemock`) holds the generated mocks.

| File | Interface | Purpose |
| --- | --- | --- |
| `auth_attempt.go` | `AuthAttemptService` | start an attempt, record identifier and password, issue and verify challenges, check liveness, hand off |
| `on_success_handler.go` | `OnSuccessHandler` | run a step's outcome, such as creating the user |
| `sso_services.go` | `SSOProviderResolver`, `SSORedirectIssuer`, `SSOIdentityService` | look up providers, issue redirects, load and bind external identities |
| `password_policy.go` | `PasswordPolicy` | the project's password length bounds |
| `completion.go` | `CompletionPolicy` | may refuse to complete a flow |

## Tests

Each test file is named after the concern it covers. `*_internal_test.go`
files test unexported helpers; the rest drive the engine through
`StateMachine` with mocks from `flowengine/mock`.
