# Evaluation

The engine ([`internal/policy`](../../../internal/policy/)) evaluates one
resolved instance against one request context and returns a decision. It is
stateless: it never fetches its own inputs. Every rule runs, so a denial lists
every requirement the request missed.

## The context schema

The template's `config` says what a developer may configure. Its
`context` says what the rules receive, and doubles as the CEL type
environment.

```json
// user.password.save — context, Zitadel-defined, versioned with the server
{
  "candidate": {
    "length": "int"
  },
  "history_matches": "list<bool>"
}
```

Every field is a derived value. `history_matches[i]` says whether the
candidate matched the i-th most recent previous password; the rule never sees
a hash, let alone a password. A rule referencing a field outside the schema
fails the type check at startup, which is what makes the context schema a
contract the server enforces. The blocklist rule adds
`candidate.in_blocklist` when it lands with #898.

Shared envelope fields (`user`, `request`) are added to the context only once
a rule needs them: every field in the context is an attack surface
for a decision log.

## The context builder

Each operation has one Go function that derives the context, listed per
operation in the [catalog](catalog.md). For `user.password.save` it is
`service.PasswordPolicy.buildContext`, and it is where #898's password
handling lives:

- the candidate is NFC-normalized before anything else
  (`domain.NormalizePassword`, applied on hashing and verification too);
- `candidate.length` counts Unicode code points, not bytes;
- `history_matches` costs one slow hash verification per entry (argon2id per
  ADR 029), which is why `history_depth` is capped at 4. Today the current
  password is the only entry: it counts as soon as history is on. The history
  table that keeps older passwords, prunes beyond the depth and is deleted
  with the user is pending under #898.

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

A template that fails a startup check stops the server before it serves
traffic, so a bad rule never reaches a running system. The values live in
`policy.DefaultLimits` and are sized for a handful of scalar comparisons per
rule. Kubernetes enforces the same pair (a static per-expression limit and a
per-request runtime budget); OpenFGA caps condition cost the same way.

The environment is the CEL standard library plus the `strings` and `lists`
extensions, nothing else.
