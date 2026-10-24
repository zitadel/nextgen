# Evaluation

The engine ([`internal/policy`](../../../internal/policy/)) evaluates one
resolved instance against one request context and returns a decision. It is
stateless: it never fetches its own inputs. Every active rule runs, so a
denial lists every requirement the request missed.

## Active rules

A rule is active when the setting it reads is set in the instance. With no
instance, or an empty `config`, no rule is active: `Evaluate` allows without
reading the context, so a caller with nothing to enforce pays for nothing.
Otherwise every active rule runs and the decision maps each failed rule to the
value of its setting:

```json
{ "allow": false, "violations": { "min_length": 12, "history_depth": 4 } }
```

## The context schema

The template's `config` says what a developer may configure. Its
`context` says what the rules receive, and doubles as the CEL type
environment.

```json
// auth.factor.password.set — context, Zitadel-defined, versioned with the server
{
  "candidate": {
    "length": "int"
  },
  "self_service": "bool",
  "history_matches": "list<bool>"
}
```

Every field is a derived value. `self_service` says whether the user sets
their own password. `history_matches[i]` says whether the
candidate matched the i-th most recent kept password, the current one first;
the rule never sees a hash, let alone a password. A rule referencing a field
outside the schema fails the type check at startup, which is what makes the
context schema a contract the server enforces.

Only the fields an active rule reads have to be present, and the engine
knows which, since it reads them from the checked expressions. A required
field that is missing, `null` (an untyped nil) or mistyped is an error and
the operation fails closed, never a silent allow. A typed nil slice counts as
an empty list, since a builder that collected no entries has nothing to
report. A builder asks the bound instance (`policy.Bound.Active`) whether a
rule is on before it derives an expensive field only that rule reads, so with
history off no history hash is verified; naming a rule the template does not
have is an error, so a misspelled name cannot skip the field and pass an
empty list.

Shared envelope fields (`user`, `request`) are added to the context only once
a rule needs them: every field in the context is an attack surface
for a decision log.

## The context builder

Each operation has one Go function that derives the context, listed per
operation in the [catalog](catalog.md). For `auth.factor.password.set` it is
part of `service.PasswordPolicy.CheckPassword`, and it is where #898's
password handling lives:

- the candidate is NFC-normalized before anything else
  (`domain.NormalizePassword`, applied on hashing and verification too);
- `candidate.length` counts Unicode code points, not bytes;
- `history_matches` costs one slow hash verification per entry (argon2id per
  ADR 029), which is why `history_depth` is capped at 4. Depth N counts the
  current password: the candidate is compared with the current password and
  the N-1 before it, so a project asking for 4 matches PCI DSS 8.3.7's "any of
  the last four". Storage keeps every replaced password (#1363). The builder
  hands over the kept passwords newest first, current one first, and may
  hand over more than the depth: the rule only looks at the first N entries,
  so a builder that sends too many cannot deny a password that matches none
  of the last N. The gate reads and verifies no more than N. History is
  checked only when the user sets their own password: the rule reads
  `self_service`, and the gate verifies hashes only then. An administrator
  setting a password, and a new user, have none to compare with, and an
  administrator learning that a guess matches an old password would be an
  oracle on the user's previous passwords. No self-service path sets the flag
  yet; the password change and reset journeys will. A candidate over the
  64 code-point cap is refused without reading or verifying anything. The
  comparison runs before the write's transaction, so the write checks that
  the password it replaces is still the one the comparison saw as current;
  when another change landed in between, it fails with `user.conflict` (409)
  and the retry compares against that change.

## Limits

A rule is an expression a customer may one day author, so the engine bounds
what one rule can be and what it can cost. Four checks, the first three at
server start for every rule in every template, the last on every evaluation:

- Type check. The expression is compiled against the template's `config`
  and `context` schemas and must produce a `bool`. A reference to a field the
  context does not declare fails here.
- Expression length. The source text of one rule is capped. A rule that
  needs more is two rules.
- Estimated cost. cel-go estimates the worst-case work of an expression
  without running it, by walking the parsed tree; since a list's length is
  unknown statically, context lists are assumed to hold a fixed maximum. The
  estimate must stay under a cap.
- Runtime cost. cel-go counts evaluation steps while a rule runs and
  aborts past a budget. The rule also runs under the request's context
  deadline.

A template that fails one of these checks fails `policy.New()`, which the
server calls at startup, so a bad rule never reaches a running system. The values live in
`policy.DefaultLimits()` and are sized for a handful of scalar comparisons per
rule. Kubernetes enforces the same pair (a static per-expression limit and a
per-request runtime budget); OpenFGA caps condition cost the same way.

The environment is the CEL standard library plus the `strings` and `lists`
extensions, nothing else.

Evaluating the three password rules on a bound instance takes about 2.8 µs
and 76 allocations; the same checks written in Go take about 0.08 µs
(`BenchmarkEvaluate_CEL` / `BenchmarkEvaluate_Go`, Apple M5 Pro), without
building the context. CEL costs
roughly 30 times plain Go here, still a few microseconds per evaluation. The
whole gate a password set goes through (resolve, bind, normalize and count,
build the context, evaluate the length rules) takes about 1.9 µs and 50
allocations (`BenchmarkPasswordPolicy_Check`), without the storage read that
resolution becomes once instances are stored, without history verification
and without hashing.
