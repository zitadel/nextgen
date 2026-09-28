# Evaluation

The engine ([`internal/policy`](../../../internal/policy/)) evaluates one
resolved instance against one request context and returns a decision. It is
stateless: it never fetches its own inputs. Every rule runs, so a denial lists
every requirement the request missed.

## The context schema

The template's `config` says what a developer may **configure**. Its
`context` says what the rules **receive**, and doubles as the CEL type
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
contract rather than documentation. The blocklist rule adds
`candidate.in_blocklist` when it lands with #898.

Shared envelope fields (`user`, `request`) are added to the context once a
rule needs them, not before: every field in the context is an attack surface
for a decision log.

## The context builder

Each operation has one Go function that derives the context, listed per
operation in the [catalog](catalog.md). For `user.password.save` it is
`service.PasswordPolicy.buildContext`, and it is where #898's password
handling lives, not in the rules:

- the candidate is NFC-normalized before anything else
  (`domain.NormalizePassword`, applied on hashing and verification too);
- `candidate.length` counts Unicode code points, not bytes;
- `history_matches` costs one slow hash verification per entry (argon2id per
  ADR 029), which is why `history_depth` is capped at 4. Today the current
  password is the only entry: it counts as soon as history is on. The history
  table that keeps older passwords, prunes beyond the depth and is deleted
  with the user is pending under #898.

## Limits

Checked once, at server start, for every rule in every template
(`policy.DefaultLimits`):

| Limit | Value | What it bounds |
|---|---|---|
| expression length | 256 bytes | the source of one rule |
| estimated cost | 10 000 | the worst-case static cost of one rule, with context lists assumed to hold at most 64 entries |
| runtime cost | 10 000 | the tracked cost of one rule evaluation |

The expression must also type-check to `bool` against `config` plus
`context`. At evaluation time the program runs under the runtime cost limit
and the request's context deadline. Kubernetes enforces the same pair (a
static per-expression limit and a per-request runtime budget); OpenFGA caps
condition cost at 100 by default. A rule that needs more than this is two
rules.

The environment is the CEL standard library plus the `strings` and `lists`
extensions, nothing else, pinned per catalog version.
