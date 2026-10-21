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
    { "name": "history_depth", "expression": "!history_matches.slice(0, size(history_matches) < config.history_depth ? size(history_matches) : config.history_depth).exists(m, m)" }
  ]
}
```

## `config`

One entry per setting: its type (`integer` or `boolean`) and, for an
integer, `minimum` and `maximum`. There is nothing else: no default, no
recommendation, no marker. There are no string settings: a string has no
size the startup cost estimate could bound a rule by, so one needs a length
bound that also feeds the estimator before a template may declare it.

- Omitted means off. A setting the instance does not set switches off the
  rule that reads it, and an instance with an empty `config` enforces
  nothing. Zitadel does not choose a value on the project's behalf; a starter
  instance can be scaffolded by the CLI and skipped.
- Bounds are technical. A bound exists only where the server cannot go
  further: 64 code points is the domain's password cap
  (`domain.MaxPasswordLength`), and 4 passwords, the current one included,
  is what one save can afford to verify. A test ties each bound to its Go
  constant: the length bounds equal `domain.MaxPasswordLength`, and the
  history bound may not exceed the current password plus the
  `domain.UserPasswordHistoryDepth` kept ones storage returns. Raising a limit later
  widens what an instance may set and breaks none; lowering one would, so a
  test holds every template to the record in
  `internal/policy/testdata/settings_compat.json`, which must equal the
  templates. Settings may be added, bounds widened and config rules dropped;
  a record diff that removes, retypes or narrows a setting, or adds or
  changes a config rule, is the signal that stored instances need a
  migration first.
- What the server enforces regardless of any policy stays in the domain. The
  64 cap is checked by `domain.HashPassword` whether or not a policy exists;
  `max_length` only lets a project go lower.

## `config_rules`

Named boolean expressions over `config` alone (the context is not in scope,
so a reference to it fails to compile). They catch combinations a single
setting's bounds cannot express, such as a minimum above the maximum. A config
rule runs when every setting it reads is set, whenever an instance is
bound: on publish, in release validation and when the instance is resolved
for an operation, never per evaluation. A stored instance that fails a new
config rule would therefore fail its operation, so the compatibility test
makes adding or changing one show up as a change to
`internal/policy/testdata/settings_compat.json`, which reviewers treat as a
migration of stored instances. A config rule must read at least one setting.

## `context`

The schema of what the rules receive: derived values computed in Go for this
one evaluation, with the raw input kept out. It is also the CEL type
environment the rules are checked against, so a rule referencing an
undeclared field fails `policy.New()`. The context builder per operation is
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
to keep in step. Rule names are therefore public API: snake_case (checked
when the template is parsed), and never renamed once published; a change in
meaning is a new rule.

Context fields take one of `int`, `bool`, `string`, `list<int>`,
`list<bool>`, `list<string>`. CEL could declare more, but the engine could
not fill them from a request, so a template that uses another type is
refused instead of failing every evaluation.

A rule is active when its setting is set. `history_depth` reads its setting
to take the newest N entries of `history_matches`, so the builder may hand
over every kept password it has and the rule still compares only the last N.
Extra entries are ignored, never counted against the user.

A comprehension variable must not reuse the name of a context field or
`config` (`history_matches.exists(candidate, candidate)` is refused): inside
the comprehension the name would mean the local variable, and the engine
would count an input the rule does not read.

Rules are atomic by construction: an expression must type-check to `bool`,
stays under a length cap, and its statically estimated cost stays under a
limit, all checked by `policy.New()`
([Evaluation](2-evaluation.md#limits)). A rule that needs more than that is
two rules.

## Validating an instance

`policy.Engine.Bind` checks an instance and returns it bound, ready to
evaluate; `policy.Engine.ValidateInstance` runs the same check for publishing
and release validation. Both reject, with every problem reported at once:

- a missing or `null` `config` (only an explicit `{}` switches every rule
  off), or a `kind` other than `policy`;
- a setting the template does not declare;
- a value of the wrong type, or outside the bounds;
- a config rule that does not hold.

## Publishing the catalog

The template is meant to be published read-only (`GET /policies/catalog`, not
built yet), so the console, the CLI and the `constraints` endpoint render
from the same source. Until then the CLI is meant to read the settings from
the operation-typed wire schema, which a test will keep in parity with the
template once the resource PR adds it ([catalog](catalog.md)).
