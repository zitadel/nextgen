# Policy catalog

The catalog is the closed list of operations a policy can guard
([ADR 066](../../adrs/066-operation-policies.md)). It lives in two places
that must agree:

- **Templates**: one JSON file per operation under
  [`internal/policy/templates/`](../../../internal/policy/templates/),
  embedded into the server binary and compiled at startup by
  `policy.New()`. A template that fails to compile (a rule that does not
  type-check, exceeds the length cap, or exceeds the static cost limit) stops
  the server before it serves traffic.
- **This document**: the human-readable index. Every operation lists its
  template file, what a developer can configure, the rules, where the request
  context is built, and the exact function that evaluates the policy.

Adding an operation means: a template file, a row here, a context builder,
and a gate call in the shared write path of that operation. Nothing else
registers it; the catalog is the set of embedded template files.

## Where evaluation happens

There is one evaluator, [`policy.Engine.Evaluate`](../../../internal/policy/engine.go).
It is stateless and never reads storage: each operation has a Go context
builder that derives the values the rules see, and a gate that calls the
engine before the operation's write. The instance that applies is resolved
by [`service.PolicyService.Resolve`](../../../internal/service/policy.go)
(newest stored revision per operation, most specific audience wins, template
defaults when the project authored nothing).

| Operation | Template | Configurable (bounds, default) | Fixed | Rules | Context built in | Evaluated in | Called from |
|---|---|---|---|---|---|---|---|
| `user.password.save` | [`user.password.save.json`](../../../internal/policy/templates/user.password.save.json) | `min_length` (8 to 64, 15; warns below 15), `history_depth` (0 to 4, 0) | `max_length` = 64 | `min_length`, `max_length`, `history` | [`service.PasswordPolicy.buildContext`](../../../internal/service/password_policy.go): NFC-normalized candidate, code-point length, current-password match when history is on | [`service.PasswordPolicy.Check`](../../../internal/service/password_policy.go) | [`service.SetPasswordUserAction.Apply`](../../../internal/service/user.go), the single write path for every password set: `PUT /users/{id}/password` and the registration flow (`FlowCreateUserWithPasswordHandler`) |

Pending for `user.password.save` (tracked in #898): the `blocklist` rule and
the history table beyond the current password.

## Where the constraints are read

The pre-auth projection ([`policy.Engine.Constraints`](../../../internal/policy/engine.go))
is what a client renders before the user types. Today it reaches the login
surface through the flow field validation:
[`service.PasswordPolicy.FieldValidation`](../../../internal/service/password_policy.go)
is wired into `domain.SchemaFieldResolver.PasswordValidation` in
[`cmd/server/server.go`](../../../cmd/server/server.go), so the
`x-auth-methods#password` field carries `minLength` and `maxLength` from the
policy instead of a constant. The unauthenticated
`GET /policies/{operation}/constraints` endpoint the ADR describes is not
built yet.

## Where instances come from

The wire schema of an instance is a union discriminated on `operation`
(`api/openapi/components/flows/policy.yaml`), one branch per row of the table
above with that operation's `config` typed from its template
(`policy-user-password-save.yaml` for the first row). A Go test in
`internal/policy` keeps each branch's settings, bounds and defaults equal to
the template's.

Instances are revisions of the `policy` resource: authored as
`.zitadel/policies/<operation>.json`, published by `zitadel apply` through
`POST /policies`, stored in the `policies` table, and read back with
`zitadel policies list` and `zitadel policies get <id>`. The default instance
`zitadel setup` scaffolds is
[`packages/config/defaults/default-password-policy.json`](../../../packages/config/defaults/default-password-policy.json).
