# Template

One template per operation, defined by Zitadel and shipped with the server
([`internal/policy/templates/`](../../../internal/policy/templates/)). A
template has four parts: `config`, the settings an instance may set;
`config_rules`, how those settings relate to each other; `context`, the
values the rules receive; `rules`, the named boolean CEL expressions that must
all hold, as far as they are active, for the operation to proceed.

```json
// auth.factor.password.set — template
{
  "operation": "auth.factor.password.set",
  "config": {
    "min_length":    { "type": "integer", "minimum": 1, "maximum": 64 },
    "max_length":    { "type": "integer", "minimum": 1, "maximum": 64 },
    "history_depth": { "type": "integer", "minimum": 1, "maximum": 4 }
  },
  "config_rules": [
    { "name": "min_length_not_above_max_length", "expression": "config.min_length <= config.max_length" }
  ],
  "context": {
    "candidate":       { "length": "int" },
    "history_matches": "list<bool>"
  },
  "rules": [
    { "name": "min_length",    "expression": "candidate.length >= config.min_length" },
    { "name": "max_length",    "expression": "candidate.length <= config.max_length" },
    { "name": "history_depth", "expression": "size(history_matches) <= config.history_depth && !history_matches.exists(m, m)" }
  ]
}
```

## `config`

One entry per setting: its type (`integer`, `boolean`, `string`) and, for an
integer, `minimum` and `maximum`. There is nothing else: no default, no
recommendation, no marker.

- Omitted means off. A setting the instance does not set switches off the
  rule that reads it, and an instance with an empty `config` enforces
  nothing. Zitadel does not choose a value on the project's behalf; a starter
  instance can be scaffolded by the CLI and skipped.
- Bounds are technical. A bound exists only where the server cannot go
  further: 64 code points is the domain's password cap
  (`domain.MaxPasswordLength`), 4 kept passwords is what one save can afford
  to verify (`domain.UserPasswordHistoryDepth`). A test keeps each such bound
  equal to its Go constant, so the two cannot drift. Raising a limit later
  widens what an instance may set and breaks none; lowering one would, so a
  test holds every template to the record in
  `internal/policy/testdata/settings_compat.json`: settings may be added and
  bounds widened, never removed, retyped or narrowed.
- What the server enforces regardless of any policy stays in the domain. The
  64 cap is checked by `domain.HashPassword` whether or not a policy exists;
  `max_length` only lets a project go lower.

## `config_rules`

Named boolean expressions over `config` alone (the context is not in scope,
so a reference to it fails to compile). They catch combinations a single
setting's bounds cannot express, such as a minimum above the maximum. A config
rule runs when every setting it reads is set, and only when an instance is
validated: on publish and in release validation, never when the operation
runs. A config rule must read at least one setting.

## `context`

The schema of what the rules receive: derived values computed in Go for this
one evaluation, with the raw input kept out. It is also the CEL type
environment the rules are checked against, so a rule referencing an
undeclared field fails at server start. The context builder per operation is
described in [Evaluation](2-evaluation.md). Only Zitadel's templates read the
context, so it can change with the server; it is not a public contract.

## `rules`

Each rule is one boolean expression that reads exactly one setting and
carries that setting's name, and every setting is read by its rule.
`policy.New()` refuses a template where a rule reads no setting, reads two,
or is named differently, and one with a setting no rule reads, which an
instance could set to no effect. A template with a key the format does not
have (a misspelled `config_rules`, a `default`) is refused too, rather than
the key being ignored.

The rule is what makes the naming worth enforcing: the name is at once the
setting in the instance, the key of a violation in a denial, the key in
`constraints`, and the suffix of the login text key
(`error.x-auth-methods#password_min_length`). One name, four places, nothing
to keep in step. Rule names are therefore public API: snake_case, and never
renamed once published; a change in meaning is a new rule.

A rule is active when its setting is set. `history_depth` shows why the rule
reads the setting even though Go applies the depth when building
`history_matches`: without the reference the rule would read no setting.
Its first clause also checks that the builder did not hand over more entries
than the depth asks for.

Rules are atomic by construction: an expression must type-check to `bool`,
stays under a length cap, and its statically estimated cost stays under a
limit, all checked when the server starts
([Evaluation](2-evaluation.md#limits)). A rule that needs more than that is
two rules.

## Validating an instance

`policy.Engine.Bind` checks an instance and returns it bound, ready to
evaluate; `policy.Engine.ValidateInstance` runs the same check for publishing
and release validation. Both reject, with every problem reported at once:

- a setting the template does not declare;
- a value of the wrong type, or outside the bounds;
- a config rule that does not hold.

## Publishing the catalog

The template is meant to be published read-only (`GET /policies/catalog`, not
built yet), so the console, the CLI and the `constraints` endpoint render
from the same source. Until then the CLI reads the settings from the
operation-typed wire schema, which a test keeps in parity with the template
([catalog](catalog.md)).
