# ADR 056: Policy Gates

> **Status:** Draft
> **Date:** 2026-08-28
> **Context:** [#383](https://github.com/zitadel/nextgen/issues/383) asks for the
> settings-and-policies architecture; [#899](https://github.com/zitadel/nextgen/issues/899)
> defines the product model; [#898](https://github.com/zitadel/nextgen/issues/898)
> is the first consumer. Supersedes the draft ADRs in
> [#937](https://github.com/zitadel/nextgen/pull/937), whose numbers now collide
> with accepted ADRs on `main`.
> **Related:** [ADR 020](020-credentials-out-of-user-schema.md),
> [ADR 035](035-configuration-environments.md),
> [ADR 042](042-scaffolded-file-ownership-and-drift-detection.md),
> [ADR 048](048-wide-events-internal-audit-primitive.md)

## Problem

Nothing about how an authentication method behaves is configurable. Password
minimum length is `MinLength: 8`, a constant at
`internal/domain/flow_field_resolver_schema.go:157` carrying
`TODO: should come from policy or user-schema`. Passkey user verification is a
fixed `"preferred"`. Failed attempts are recorded for rate limiting that reads
them nowhere.

#899 defines settings, policies and user state as a product model but leaves
open where configuration lives. #383 asks for the architecture and requires that
future inheritance not be foreclosed.

## Decision

A **policy is a gate**: a named point in front of one domain operation, carrying
both the settings for that operation and the rule that evaluates them.

| Part | What it is | Who owns it |
|---|---|---|
| Gate name | `user.password.save` | Zitadel — closed catalogue |
| Context schema | what the rule receives at runtime | Zitadel — versioned with the server |
| Settings JSON Schema | which settings exist, and their legal values | Zitadel — versioned with the server |
| Settings document | `.zitadel/policies/user.password.save.json` | developer |
| Rule | `.zitadel/policies/user.password.save.rego` | Zitadel ships a default; developer may replace it |
| Failure posture | what a rule error means | Zitadel — per gate |

Settings document and rule are both revisioned resources pinned into the ADR 035
release.

### Naming: gates are not events

A gate runs **before** an operation, synchronously, and returns a verdict. A wide
event (ADR 048) records what happened **after**, and cannot affect the outcome.
Both exist, so the names must not collide:

| Gate — before, blocking | Wide event — after, observational |
|---|---|
| `user.password.save` | `user.password.saved` |
| `user.create` | `user.created` |

Every vendor that ships both keeps them lexically apart. Okta: *"Inline hooks use
synchronous calls, which means that the Okta process that triggered the hook is
paused"* versus event hooks, which are *"meant to deliver information about
events that occurred, not to provide a way to affect the execution of the
underlying Okta process flow."* Auth0 labels each Action trigger synchronous or
asynchronous; Google Identity Platform calls the blocking kind *blocking
functions*. Reusing one word for both invites wiring a policy to the audit bus
and wondering why denial does nothing.

## Decision 1 — A policy is a gate, not a single control

#899 reads as one control per configurable thing, which produces a resource per
scalar and forces its own composition machinery ("combine all applicable
policies into one effective set") to exist on day one purely to reassemble what
was split apart.

Bundling by gate makes the unit of configuration equal the unit of evaluation.
`user.password.save` carries minimum length, maximum length, history depth and
blocklist behaviour together, because they are decided at the same moment
against the same context.

- Composition mostly disappears for MVP: one gate, one policy, one evaluation.
- More than one policy per gate stays reachable — the gate name is the join key
  — and is not built now.
- A control that matters at two gates is configured at both. Explicit
  duplication beats implicit sharing across operations that can diverge.

## Decision 2 — The gate catalogue is closed

Developers configure gates and may replace a rule. They cannot define a gate,
attach arbitrary code to one, or reach the network from one.

That boundary is what separates this from a hook or actions system:

- no new extension points — the catalogue ships with the server;
- no outbound calls and no external code execution;
- no side effects — a gate returns a verdict, it does not mutate;
- the context is a fixed, versioned schema per gate, not an open payload.

**MVP catalogue: `user.password.save` only.** #898 needs exactly one. Further
gates arrive with the epics that need them.

## Decision 3 — Settings are JSON, bounded by a per-gate JSON Schema

```json
// .zitadel/policies/user.password.save.json
{
  "kind": "policy",
  "gate": "user.password.save",
  "min_length": 15,
  "max_length": 256,
  "history_depth": 5,
  "reject_current": true
}
```

The metaschema ships with the server and is the authority for which settings a
gate accepts and which values are legal. Bounds belong in the schema, not the
rule:

```json
"min_length":    { "type": "integer", "minimum": 4,  "default": 15 },
"max_length":    { "type": "integer", "minimum": 64, "default": 256 },
"history_depth": { "type": "integer", "minimum": 0, "maximum": 24, "default": 0 }
```

`minimum: 4` is #898's "Projects can configure a minimum of 4 characters or
higher". `minimum: 64` is "at least 64 Unicode characters". A violation is
rejected at release construction with the offending field named.

Not every requirement is a bound. #898 also wants a **warning** when the minimum
is below 15 — advisory, not rejection. JSON Schema can only hard-fail, so
advisories are expressed as rules over the settings document, evaluated at
publish time alongside cross-resource checks.

## Decision 4 — The rule is Rego, shipped by default, overridable, and in the release

Zitadel ships a default module per gate. It is a real file, not hidden behaviour:
`zitadel policies eject user.password.save` writes it into `.zitadel/policies/`.
A developer may edit it, and most never will.

The half that matters: **the rule travels in the release with the settings it
reads.**

Every comparable product keeps its rules outside versioned configuration. Auth0
Actions, Cognito Lambda triggers and Okta Inline Hooks are live mutable code:
deploying one takes effect everywhere at once, with no preview environment for
the rule, no promotion, and no way to roll a rule back together with the
settings it depends on.

Under ADR 035 both files are pinned by revision into the same release. A stricter
rule and the setting it reads are proved on a preview environment and promoted
as one artifact, or rolled back as one. Kubernetes made the same move for the
same reasons, replacing per-decision admission webhooks with in-process
declarative policy.

Rego rather than Go-only because a rule a developer can read and replace has to
be data, not a recompile. Rego rather than a remote policy server because a
release must behave identically when promoted, which a server we do not version
cannot guarantee.

## Decision 5 — Context is derived facts, never secrets

```json
{
  "operation": "user.password.save",
  "user":      { "id": "usr_…", "schema": "human-user", "created_at": "…" },
  "request":   { "ip": "…", "user_agent": "…", "origin": "…" },
  "candidate": { "length": 14, "in_blocklist": false },
  "history_matches": [false, false, true, false, false],
  "current_matches": false
}
```

The plaintext password does not enter the context. This is forced, not preferred:

1. **The engine cannot do the work.** Verified on OPA 1.14.1: `crypto.sha256`
   exists, but `crypto.bcrypt.verify` and `crypto.argon2.verify` are undefined
   functions. This repo hashes through `zitadel/passwap`
   (`internal/crypto/passwap.go`) over argon2, bcrypt, scrypt and pbkdf2;
   comparing a candidate to a stored hash means `VerifyHash` with per-entry salt
   and cost parameters. Go must do it.
2. **Decision logs capture the full input by default**, and trace output dumps it
   too. A plaintext password in the context is a plaintext password in a log
   file.
3. **#898 requires NFC normalization before any length check.** A `count()` over
   a raw string counts the wrong thing.

Go derives; the rule decides. The rule keeps the *policy* semantics — Go reports
**which** stored passwords matched, the rule decides **how far back that counts**:

```rego
violations contains v if {
	settings.history_depth > 0
	some i
	input.history_matches[i] == true    # newest-first, one entry per stored password
	i < settings.history_depth          # the policy decision lives here
	v := {"rule": "history", "depth": settings.history_depth, "position": i + 1}
}
```

Identical context, only the setting changing:

```
history_depth=5  {"allow":true,  "violations":[]}
history_depth=6  {"allow":false, "violations":[{"depth":6,"position":6,"rule":"history"}]}
```

The engine is also stateless: it never fetches its own inputs. A lockout
threshold is settings; the attempt count is user state the platform passes in.

**Cost.** Each history entry checked costs one full KDF verification, and argon2
and bcrypt are deliberately expensive. Go bounds the work by the metaschema
maximum and the rule applies the configured window — bounded cost, semantics stay
in the rule. This also gives #898's open question a basis: the ceiling on history
depth is set by acceptable password-change latency, not by storage.

## Decision 6 — Two questions per gate, and the relationship is enforced at publish

Every gate answers:

- **`constraints`** — computed from settings alone, with no context, so it
  resolves before the user has typed anything.
- **`decision`** — allow or deny over settings plus context, with
  machine-readable reasons.

The invariant between them: **anything `decision` can deny for must appear in
`constraints`.** A rule discoverable only by failing is a rule the user cannot
satisfy.

This is not theoretical. `minLength` is rendered as well as enforced — one value
already feeds the client hint and the server-side check
(`internal/domain/flow_field_resolver.go:140` →
`internal/domain/flow_field_validation.go`). Keycloak shipped without the
projection and had to retrofit it: password policies were unreachable from login
themes, so users could not see requirements before submitting
([keycloak#32553](https://github.com/keycloak/keycloak/issues/32553)).

Because developers may replace the rule, the invariant cannot be a convention.
It is checked at release construction:

```rego
undeclared contains rule if {
	some v in violations
	rule := v.rule
	not constraints[rule]      # denied for something never rendered
}
```

A release whose rule produces a non-empty `undeclared` for any context in the
gate's conformance suite is rejected.

`constraints` also projects into the shape the flow engine already speaks, so the
login form needs no new contract:

```json
{ "type": "string", "minLength": 15, "maxLength": 256 }
```

**Failure posture is declared per gate.** `user.password.save` fails closed. A
gate whose closed failure would lock every user out of the login screen declares
open and logs — #899 requires a default that preserves at least one valid path.

## Ownership

#383 requires one explicit owner and no automatic inheritance. Neither issue
defines "owner", and the word carries several jobs. This ADR pins it to one:

> **Owner is the resolution root — the resource whose configuration the runtime
> reads to obtain the effective value.**

The other jobs keep their existing homes: who may view and change it →
permission catalogs ([ADR 032](032-permission-catalogs.md),
[033](033-internal-permission-management.md),
[034](034-external-permission-management.md)); what it affects → applicability,
which #899 already separates from ownership; what happens when the owning
resource is deleted → explicit lifecycle policy in
[ADR 024](024-user-team-lifecycle-ownership.md)'s style, never a cascade; where
it is authored → the release (ADR 035).

In MVP the resolution root is always the Project, so no owner field is minted.
#383's future-compatibility requirement is met by the gate catalogue declaring
which owner kind a gate resolves from — a property of the catalogue, not
machinery to build now.

**Team-owned policies are out of scope, and not for scheduling reasons.** Per
[`hierarchy.md`](../design/api/hierarchy.md) a Team in a customer project is a
B2B end-customer tenant created at runtime, so a Team-owned policy would be
runtime state and fall outside the release boundary ADR 035 locked. Whether
Zitadel wants tenant-authored configuration at all is a separate decision.

## Consequences

- `MinLength: 8` at `flow_field_resolver_schema.go:157` resolves from the gate's
  settings instead of a constant.
- `x-auth-methods` keeps availability. It is a setting and it is already there;
  moving it is load-bearing across field resolution and action validation for no
  MVP gain. Revisit if [#851](https://github.com/zitadel/nextgen/issues/851)
  forces a metaschema change for per-provider availability —
  `api/openapi/endpoints/schemas/auth-methods.json` is
  `additionalProperties: false` over five fixed keys.
- ADR 035's reserved `policies` bundle key is occupied; the handle is the gate
  name.
- Both resources are revisioned-immutable from the start, so neither needs the
  retrofit flow definitions require in
  [#530](https://github.com/zitadel/nextgen/issues/530).
- Schema violations, invariant breaches and unresolvable references fail at
  publish, not at authentication time.
- Gate decisions feed the ADR 048 wide-event log, which is what makes "why was
  this denied" answerable in production. Facts-not-secrets is what makes those
  records safe to keep whole.

## Alternatives rejected

- **A resource per control.** Matches #899's vocabulary literally, and forces
  composition machinery on day one to reassemble settings that are decided
  together anyway.
- **Go only, no rule engine.** Cheapest for #898's two scalars, and every
  conditional rule after that is a code change and a release.
- **A remote policy server queried per decision.** Central control plane, and it
  breaks ADR 035: a release is meant to behave identically when promoted, which
  fails if the deciding logic lives somewhere we do not version.
- **Rules inline in the user schema.** Contradicts ADR 020 and re-revisions every
  schema on a security change.

## Open

- The second gate, and whether `user.create` or rate limiting comes first.
- Whether the default rule is ejected into `.zitadel/` on `setup` or only on
  demand.
- How an edited rule is reconciled against a newer shipped default on upgrade.
  ADR 042 solves the same problem for scaffolded files; the mechanism should be
  shared rather than reinvented.
- The maximum history depth #898 asks for, given the KDF cost per entry.
