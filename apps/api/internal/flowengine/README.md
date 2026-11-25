# flowengine

Package `flowengine` is the flow engine runtime. It starts a flow, processes
each submission and renders the step the client shows next. Within a run it
routes transitions and outcomes, handles back navigation, resolves and
collects step fields, and runs the passkey and SSO ceremonies.

It does not own:

- flow definitions and their validation, which live in `domain`; it reads the
  running flow's definition through `ActiveDefinition` (`definition.go`), from
  the `Definitions` the service builds per request;
- persistence, policy and side effects, which it calls through interfaces it
  declares (`auth_attempt.go`, `on_success_handler.go`, `sso_services.go`,
  `password_policy.go`, `CompletionPolicy` in `completion.go`) and `service`
  implements;
- keeping flow state: it takes and returns the `State` it declares
  (`state.go`), which lives in the browser cookie, sealed by the API layer.

`flowengine` imports `domain`; `domain` never imports `flowengine`. Mocks of
those interfaces are generated into `mock` (package `flowenginemock`).

Files by concern: `state_machine.go` (the interface, start and process),
`action.go` (the table of one handler per action kind, which `Process`
dispatches to), `action_<kind>.go` (one per action kind's handler),
`on_success.go` (the table of one handler per `on_success` value, which a
submit dispatches to), `challenge.go` (the table of one declaration per
two-phase ceremony method, which every ceremony is issued and verified
through), `completion.go` (the one point every completing route passes, which
asks the completion policy and mints the handoff), `routing.go`, `render.go`,
`back.go`, `fields.go`, `passkey.go` and `sso.go`. Each test file is named after the concern it covers.

The design lives in [docs/design/flowengine](../../../../docs/design/flowengine/).
