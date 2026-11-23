# flowengine

Package `flowengine` is the flow engine runtime. It starts a flow, processes
each submission and renders the step the client shows next. Within a run it
routes transitions and outcomes, handles back navigation, resolves and
collects step fields, and runs the passkey and SSO ceremonies.

It does not own:

- flow definitions and their validation, which live in `domain`;
- persistence, policy and side effects, which it calls through interfaces
  `domain` declares and `service` implements;
- keeping flow state: it takes and returns a `domain.FlowState`, which lives
  in the browser cookie, sealed by the API layer.

`flowengine` imports `domain`; `domain` never imports `flowengine`.

Files by concern: `state_machine.go` (the interface, start and process),
`actions.go` (the table of one handler per action kind, which `Process`
dispatches to), `on_success.go` (the table of one handler per `on_success`
value, which a submit dispatches to), `challenge.go` (the table of one
declaration per two-phase ceremony method, which every ceremony is issued and
verified through), `routing.go`, `render.go`, `back.go`, `fields.go`,
`passkey.go` and `sso.go`; each handler lives in its concern's
file, and each test file is named after the concern it covers.

The design lives in [docs/design/flowengine](../../../../../docs/design/flowengine/).
