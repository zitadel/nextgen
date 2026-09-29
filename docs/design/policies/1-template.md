# Template

One template per operation, defined by Zitadel and shipped with the server
([`internal/policy/templates/`](../../../internal/policy/templates/)). A
template has three parts: `config`, the settings a developer may set;
`context`, the values the rules receive; `rules`, the named boolean CEL
expressions that must all hold for the operation to proceed.

```json
// user.password.save — template
{
  "operation": "user.password.save",
  "config": {
    "min_length":    { "type": "integer", "minimum": 8, "maximum": 64, "default": 15, "recommended_minimum": 15, "public": true },
    "max_length":    { "type": "integer", "default": 64, "fixed": true, "public": true },
    "history_depth": { "type": "integer", "minimum": 0, "maximum": 4,  "default": 0,  "public": true }
  },
  "context": {
    "candidate":       { "length": "int" },
    "history_matches": "list<bool>"
  },
  "rules": [
    { "name": "min_length", "expression": "candidate.length >= config.min_length" },
    { "name": "max_length", "expression": "candidate.length <= config.max_length" },
    { "name": "history",    "expression": "config.history_depth == 0 || !history_matches.exists(m, m)" }
  ]
}
```

## `config`

A JSON Schema fragment per setting: type, bounds, default. The bounds are the
floor and ceiling a developer can move within; a built-in protection (the
pending `blocklist` rule) has no setting at all and therefore cannot be
turned off. This is the boundary #898 asks for: Zitadel owns the secure
baseline, the project chooses within it.

- **`fixed: true`** marks a setting that is part of the baseline: an instance
  may not set it, the default is the only value. It is still a setting rather
  than a literal in the rule so that clients learn it through `constraints`
  (`max_length` is 64 for everyone and every login form needs to know that).
- **`recommended_minimum`** marks a legal-but-discouraged range. A value
  below it is accepted and the authoring workflow warns (#898: 8 to 14 is
  allowed, 15 is what NIST requires for a single-factor password). The warning
  comes from the catalog (`policy.Engine.Warnings`), so the CLI and the
  console never hardcode the threshold. There is no API-level warning channel;
  the floor is the protection, the warning is guidance.
- **`public: true`** marks a setting the unauthenticated `constraints`
  projection may return (see [Constraints](3-constraints.md)). Unmarked
  settings are private: `max_attempts` on a lockout policy would tell an
  attacker their budget.

An instance is validated against `config` at write time
(`policy.Engine.ValidateInstance`): a key the template does not declare, a
fixed setting, or a value outside the bounds is rejected. Omitted settings
take their default, so the engine always evaluates a complete config.

## `context`

The schema of what the rules receive: derived values computed in Go for this
one evaluation, never the raw input. It is also the CEL type environment the
rules are checked against, so a rule referencing an undeclared field fails at
server start. The context builder per operation is described in
[Evaluation](2-evaluation.md).

## `rules`

An ordered list. Each rule is one boolean expression; its name is what a
denial reports and what the `constraints` projection lists. Rules are atomic
by construction: an expression must type-check to `bool`, stays under a
length cap, and its statically estimated cost stays under a limit, all
checked when the server starts ([Evaluation](2-evaluation.md#limits)). A rule
that needs more than that is two rules.

**A rule reads every setting it gates on.** A setting that only steers the Go
context builder (say, how many history entries to compare) would be invisible
to `constraints`. `history` therefore reads `config.history_depth` even though
the depth is applied in Go; that is what makes the depth renderable.

## Publishing the catalog

The template is meant to be published read-only (`GET /policies/catalog`, not
built yet), so the console, the CLI and the `constraints` endpoint render
from the same source. Until then the CLI reads the settings from the
operation-typed wire schema, which a test keeps in parity with the template
([catalog](catalog.md)).
