# Constraints

A login form has to render "at least 12 characters" *before* anyone types,
which means part of the policy has to reach an unauthenticated client.
Alongside `evaluate`, every policy therefore answers a second query,
`constraints`: computed from the instance's settings alone, with no request
context, so it resolves before the user has typed anything.

`policy.Engine.Constraints` returns every active rule keyed by name with the
value of its setting:

```json
{
  "operation": "auth.factor.password.set",
  "rules": { "min_length": 12, "max_length": 32, "history_depth": 4 }
}
```

With no instance, or an empty `config`, `rules` is empty: nothing is
enforced, so nothing is announced.

The shape is the one the flow field's `validation` object already uses
(`{ "min_length": 12, "max_length": 32 }`, an absent key meaning no rule),
and a denial's `violations` uses it too. A client renders the hint before
submit and the error after it from the same keys.

## The invariant

Anything `evaluate` can deny for must be discoverable in `constraints`. A rule
found only by failing is a rule the user cannot satisfy. Keycloak shipped
without this projection and had to retrofit it: password policies were
unreachable from login themes
([keycloak#32553](https://github.com/keycloak/keycloak/issues/32553)).

With a rule list the invariant holds by construction: `constraints` is the
set of active rules, each with its setting, and a rule is active in both
queries under the same condition. Which setting a rule reads is known
statically from its checked expression, so nothing is authored twice.

Every rule today is a requirement the caller fixes by changing the input, so
every rule and its setting are disclosed. A rule that must stay hidden (a
lockout threshold an attacker would budget against) is not a requirement in
that sense; the first one brings a disclosure marker, required on every rule,
and drops out of both `constraints` and the denial detail.

Client-side validation is UX, never enforcement. The server re-checks
everything: the flow engine's payload validation and the policy gate are the
same check at different costs, deliberately.

## Delivery through the flow engine

For flows, the flow engine embeds constraints in the step it already sends;
no new endpoint, and the client contract does not change:

```json
{ "min_length": 12, "max_length": 32 }
```

On every step where the password is saved (registration, a reset), the
`x-auth-methods#password` field's `validation` carries the project's
`min_length`, and `max_length` as the lower of the policy's value and the
domain cap of 64, so a form knows the cap even when no policy is set. Where
the password is verified instead (a login), the field carries no length
rules: a stored password that predates a stricter policy must still sign in.
The field validator re-checks the rules on submit, counting the NFC-normalized
candidate in code points, before the domain operation and the full policy
evaluation run. The wiring is tracked in
[#1449](https://github.com/zitadel/nextgen/issues/1449).

## The read endpoint (not built yet)

For clients not driven by the flow engine, a custom login on the SDK or a
self-service password change inside a customer application, the same
projection needs a read endpoint, unauthenticated because the login form is
pre-auth.

```http
GET /policies/auth.factor.password.set/constraints
```
```json
{
  "operation": "auth.factor.password.set",
  "release": "rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  "rules": { "min_length": 12, "max_length": 32, "history_depth": 4 }
}
```

Four properties of that endpoint are load-bearing:

- The path names the projection, not the document.
  `GET /policies/{operation}` would imply the instance itself. Returning
  `constraints` under its own path keeps the two apart, which matters once a
  hidden rule exists.
- It never 404s for a catalogued operation. With no instance it answers with
  empty `rules`. A 404 means the operation is not in the catalogue: a client
  bug, not an unconfigured project.
- It is cacheable on the release. Constraints change only when a release
  is deployed, so the response carries its `release` id and that id is the
  `ETag`. This waits for release-pinned resolution; today the newest stored
  revision applies.
- It is scoped like any other public read, resolving the project the same
  way the rest of the unauthenticated surface does, and reading from that
  environment's active release.
