# ADR 053: Policy Evaluation

> **Status:** Draft
> **Date:** 2026-08-21
> **Context:** [ADR 052](052-policy-configuration.md) decides where configuration
> lives. This ADR decides what turns it into a decision at runtime, in answer to
> [#383](https://github.com/zitadel/nextgen/issues/383).
> **Related:** [#899](https://github.com/zitadel/nextgen/issues/899),
> [ADR 035](035-configuration-environments.md)

Terminology is defined in [ADR 052](052-policy-configuration.md). This ADR adds four
words:

| Term | Meaning |
|---|---|
| **Decision point** | A named question the platform asks during an operation. |
| **Facts** | The input assembled by the caller for a decision point. |
| **Engine** | Whatever turns facts plus configuration into a decision. |
| **Constraints** | The part of the effective requirements that can be shown *before* the operation. |

## Context

Password rules are checked today by constants inlined at the call site. Once policies
are configurable, and once #899 requires several policies to combine into one
effective requirement, something has to own that.

The question keeps getting conflated with "should we use OPA". It is a separate
question, and it should be answered second.

## Decision 1 — Is there a seam at all?

### Option A — Evaluate at each call site

- **Pro:** no new abstraction; the shortest path to shipping #898.
- **Con:** #899 requires that a policy cannot be bypassed through another method,
  client, API, SDK or login experience. Scattered call sites is how that requirement
  is broken.
- **Con:** no single place to compose policies from several owners.
- **Con:** the engine can never change.

### Option B — A decision point interface (chosen)

Named points, typed facts assembled by the caller, typed results:

```
auth/method/eligible        may this method be offered for this user type
auth/factor/required        is another factor needed to complete this attempt
auth/password/acceptable    does this candidate password meet policy
auth/social/provision       may this first-time social sign-in create a user
auth/social/link            may this identity attach to an existing account
```

- **Pro:** one place where composition happens and one place to audit.
- **Pro:** the engine becomes an implementation detail.
- **Pro:** the same points serve release-time validation and runtime evaluation.
- **Con:** the point names and their fact shapes become an interface we must keep
  stable once anyone outside writes policy against them.

**Decision: Option B**, with a **conformance suite**: a table of
(decision point, facts, expected result) that every engine must pass. It is what
makes composition rules testable and any later engine swap safe.

## Decision 2 — Which engine?

### Option A — Go only

- **Pro:** no dependency, fastest, easiest to debug.
- **Con:** every new conditional rule is a code change and a release.

### Option B — OPA only

- **Pro:** one engine for everything, policy-as-code from day one.
- **Con:** a dependency, a Rego test suite and a sandbox for rules that are a dozen
  scalar fields.
- **Con:** a policy the platform can only execute, never inspect, cannot produce the
  constraints the login form renders (see Decision 4).

### Option C — Go now, OPA as an additional engine later (chosen)

- **Pro:** Go always evaluates the declarative configuration. Fast path, no dependency.
- **Pro:** OPA evaluates only customer-authored conditional rules, and only when a
  customer publishes them. The dependency stays inert until then.
- **Pro:** results compose — both must allow.
- **Con:** two engines to keep in agreement, which is what the conformance suite is
  for.

**Decision: Option C**, with one safety rule: **an extension may deny, never grant.**
A customer rule cannot open a hole in the declarative policy, only lock people out,
and lockout is recoverable with a kill switch. The relaxing direction is #899's
*exception* mechanism — explicit, authorised, scoped, time-bound, visible and audited
— not an implicit consequence of how results combine.

## Decision 3 — Where does the engine run?

### Option A — Embedded in the process (chosen for evaluation)

- **Pro:** microseconds, no network hop, cannot partially fail.
- **Pro:** Zitadel ships as one binary; self-hosters get nothing new to deploy.
- **Con:** operators cannot point us at their existing policy control plane.

### Option B — A remote OPA server queried per decision

- **Pro:** central control plane, one decision-log sink, familiar to enterprises.
- **Con:** every decision point is a network round trip and a login crosses several.
- **Con:** their outage is our login outage, with only fail-open (a hole) or
  fail-closed (an outage) available.
- **Con:** breaks ADR 035. A release is meant to be an artifact that behaves
  identically when promoted. If the deciding logic lives in a server we do not
  version, the release no longer determines behaviour and an audit record cannot be
  replayed.

### Option C — External authorship, local evaluation (chosen for distribution)

Their control plane publishes a standard OPA bundle; we pull it, cache it, and
evaluate it embedded.

- **Pro:** they keep authorship, central distribution and their own log sink.
- **Pro:** we keep latency, availability and determinism.
- **Con:** the bundle must be **pinned by digest into the release**, not followed
  live, or the same release behaves differently in two environments.

**Decision: A for evaluation, C for distribution. Not B.**

## Decision 4 — What is asked, and what enters the facts?

Two query shapes, not one. A deny-only interface cannot build the login form:
`minLength` is not only enforced, it is rendered. Today one value feeds the client
hint (`internal/api/flow.go`) and the server-side validator
(`internal/domain/flow_field_validation.go`).

- **`constraints`** — the renderable projection, plus which policies contributed to
  it, because #899 requires administrators to see that attribution.
- **`decision`** — allow or deny, with a machine-readable reason.

The invariant between them: **anything `decision` can deny for must be visible in
`constraints`.** A rule discoverable only by failing is a rule the user cannot
satisfy. The client renders constraints; the server stays the only enforcement point.

### Facts: derived values, never secrets

No plaintext password reaches an engine — not a remote one, and not an embedded one
either.

- Decision logs record the full input by default. That is their purpose, and it puts a
  credential in a log file.
- Trace and explain output dumps input too, so debug mode leaks it.
- Go strings cannot be zeroed; each hand-off multiplies uncollectable heap copies.

It is unnecessary, because password policy is a function of the password's properties:

```json
{ "length": 14, "classes": ["lower", "upper", "digit", "symbol"], "inDenyList": false }
```

A customer-supplied pattern is evaluated in Go against the password and enters as a
named boolean. The rule's identity travels; the secret does not.

The engine is also **stateless**: it never fetches its own inputs. A lockout
*threshold* is policy configuration in the release; the *count* is user state the
platform owns and passes in. #899 keeps user state out of releases for the same
reason.

## Consequences

- Failure posture is declared per decision point. `auth/password/acceptable` failing
  closed is correct; `auth/method/eligible` failing closed locks everyone out of the
  login screen. #899 requires a default that preserves at least one valid path.
- An unresolved policy conflict during an operation denies the operation (#899).
  Conflicts detectable in advance are rejected at release validation instead.
- Decision records feed the wide-events audit log
  ([ADR 048](048-wide-events-internal-audit-primitive.md)), which is what makes "why
  was this denied" answerable in production. Facts-not-secrets is what makes those
  records safe to keep whole.

## Open

- The full decision point catalogue, and how per-control combination rules ("what
  counts as stricter") are declared.
- Whether operators may choose the engine per deployment.
- Whether release-time validation runs the same points over the configuration itself,
  which #899 implies when it says a policy may constrain the valid values of a
  setting.
