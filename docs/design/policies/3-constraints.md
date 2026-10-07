# Constraints

A login form has to render "at least 15 characters" *before* anyone types,
which means part of the policy has to reach an unauthenticated client.
Alongside `evaluate`, every policy therefore answers a second query,
`constraints`: computed from the template and the instance's config
alone, with no request context, so it resolves before the user has typed
anything.

`policy.Engine.Constraints` returns the rule list with, for each rule, the
`public` settings it reads:

```json
{
  "operation": "user.password.save",
  "rules": {
    "min_length": { "min_length": 15 },
    "max_length": { "max_length": 64 },
    "history":    { "history_depth": 4 }
  }
}
```

## The invariant

Anything `evaluate` can deny for must be discoverable in `constraints`. A rule
found only by failing is a rule the user cannot satisfy. Keycloak shipped
without this projection and had to retrofit it: password policies were
unreachable from login themes
([keycloak#32553](https://github.com/keycloak/keycloak/issues/32553)).

With a rule list the invariant holds by construction: `constraints` is the
list of rule names, each with the `public` settings it reads. A rule is in
`constraints` because it exists, not because a conformance suite proved it.
Which settings a rule reads is known statically from its checked expression,
so nothing is authored twice. The invariant is about rules being
discoverable, not values being public: a user learns that a blocklist check
exists; they cannot download the blocklist.

Client-side validation is UX, never enforcement. The server re-checks
everything: the flow engine's payload validation and the policy gate are the
same check at different costs, deliberately.

## Delivery through the flow engine

For flows, the flow engine embeds constraints in the step it already sends;
no new endpoint, and the client contract does not change:

```json
{ "type": "string", "minLength": 15, "maxLength": 64 }
```

`service.PasswordPolicy.FieldValidation` projects the constraints onto
`domain.FlowFieldValidation`, and the flow state machine reads it with the
flow's project id (`FlowStateMachineRuntime.WithPasswordSaveRules`, wired in
`cmd/server/server.go`) for every step where the password is saved, so the
`x-auth-methods#password` field carries the project's `minLength` and
`maxLength`. Where the password is verified instead (a login), the field
carries no length rules: a stored password that predates a stricter policy
must still sign in. The field validator re-checks the rules server-side on
submit (`SchemaFieldResolver.Validate`) before the domain operation and the
full policy evaluation run.

## The read endpoint (not built yet)

For clients not driven by the flow engine, a custom login on the SDK or a
self-service password change inside a customer application, the same
projection needs a read endpoint, unauthenticated because the login form is
pre-auth.

```http
GET /policies/user.password.save/constraints
```
```json
{
  "operation": "user.password.save",
  "release": "rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  "rules": {
    "min_length": { "min_length": 15 },
    "max_length": { "max_length": 64 },
    "history":    { "history_depth": 4 }
  }
}
```

Four properties of that endpoint are load-bearing:

- The path names the projection, not the document.
  `GET /policies/{operation}` would imply the instance itself, and that
  includes private settings. Returning `constraints` under its own path makes
  it structurally impossible to serve the private half by accident.
- It never 404s for a catalogued operation. With no instance authored the
  template defaults apply, so the endpoint still answers. A 404 means the
  operation is not in the catalogue: a client bug, not an unconfigured
  project.
- It is cacheable on the release. Constraints change only when a release
  is deployed, so the response carries its `release` id and that id is the
  `ETag`. This waits for release-pinned resolution; today the newest stored
  revision applies.
- It is scoped like any other public read, resolving the project the same
  way the rest of the unauthenticated surface does, and reading from that
  environment's active release.
