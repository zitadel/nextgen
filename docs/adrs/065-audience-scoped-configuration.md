# ADR 065: Audience as the Applicability Model for Scoped Configuration

> **Status:** Proposed
> **Date:** 2026-09-15
> **Context:** [#899](https://github.com/zitadel/nextgen/issues/899) (settings and
> policies model); operation policies ADR
> ([PR #1068](https://github.com/zitadel/nextgen/pull/1068)) is the first consumer
> beyond flow definitions
> **Builds on:** [ADR 035](035-configuration-environments.md) (releases),
> [ADR 063](063-resource-revisions-fixed-id-and-revision-id.md) (resource vs
> revision), [flow definition rules](../design/flowengine/flow-definition-rules.md)
> (`audience` field, shipped)

## Problem

Previous Zitadel versions scope configuration through the resource hierarchy:
a policy lives on the instance as the default, an organization overrides it,
and evaluation walks up the tree from the resource to the instance. The
hierarchy is both the ownership model and the applicability model at once.

Nextgen keeps a containment hierarchy — project > team > user
([`hierarchy.md`](../design/api/hierarchy.md)) — but it is a **data
hierarchy, not a configuration-inheritance chain**: nothing about containing
a resource implies contributing to its configuration.
[#899](https://github.com/zitadel/nextgen/issues/899) makes the split
explicit: every setting and policy has **one explicit owner**, and *which
requests it affects* is declared separately from *who owns it*.

Flow definitions already ship the mechanism that fills that second half: an
optional `audience` on the definition, with empty-means-project-default and
most-specific-match-wins resolution. Operation policies
([PR #1068](https://github.com/zitadel/nextgen/pull/1068)) need the same
ability — a password policy for one team stricter than the project default —
and nothing yet formalizes the mechanism as the general answer. This ADR does.

## Decision

**Configuration resources declare their applicability as an audience, not by
where they sit in a hierarchy.**

The audience of a configuration document is the set of requests it applies to,
declared as explicit references to project resources. It is applicability, not
ownership: the project owns every document, however narrow its audience. A
*document* here is a configuration resource at its newest active revision
([ADR 063](063-resource-revisions-fixed-id-and-revision-id.md)); resolution
picks between resources, not between revisions of one resource.

The model applies to configuration that is **resolved at runtime** — the
server picks which document governs an incoming request. Flow definitions are
the shipped case; operation policies (PR #1068) are next; any future
runtime-resolved configuration resource follows the same model. Configuration
whose applicability is already fixed by a reference from another resource is
out of scope: an IdP connection is available where a user schema or flow step
references its slug, so team-scoped SSO falls out of scoping the flow or the
schema. The [IdP resource model](../design/idp/1-resource-model.md) cut
`audience` from its schema citing no identified use case; this ADR keeps it
cut, and supplies the rationale the cut left implicit.

### Parameters

The parameter set is closed and Zitadel-defined; a developer picks values, not
new dimensions.

| Parameter | Matches requests… | Status |
|---|---|---|
| `team_ids[]` | targeting one of the listed teams | **applicable today** — shipped for flow definitions; first parameter for policies |
| `app_ids[]` | arriving through one of the listed applications | future capability |
| `user_schema` | for users of the referenced schema | future capability |

`app_ids` exists on flow definitions as early-draft carryover: no application
resource exists yet, so nothing can legitimately populate it. It stays in the
model as the reserved next parameter rather than being removed and re-added.

`user_schema` as an audience parameter is gated on #899's open decision
(whether schemas own configuration or configuration merely applies to a
schema's users), and on a resolution-timing question: the schema is often
known only after the user is identified, mid-flow, not at document-selection
time. Until both are settled, a flow definition's `user_schema` field remains
what it is today — the subject the flow operates on, not an audience.

### Format

The audience is one optional object field, named `audience`, on the
configuration resource. Each parameter is an array of resource ids; a request
matches a parameter when its context value is one of the listed ids:

```jsonc
"audience": { "team_ids": ["team_01k…"] }
```

The canonical shape is the published schema flow definitions already carry
([`flow-definition.json`](../../api/openapi/endpoints/schemas/flow-definition.json)).
Rules of the shape:

- **Object of named parameters, never positional.** New parameters land as new
  properties; committed documents never restructure.
- **Arrays of ids.** Values within one parameter are alternatives:
  `"team_ids": ["team_a", "team_b"]` matches either team, at the same
  specificity.
- **Omitted ≡ empty.** An absent `audience`, an empty object, and a parameter
  set to `[]` all mean the same thing: no restriction on that dimension.
- **Closed per server version.** A document naming a parameter the server does
  not implement fails validation at write time instead of silently not
  matching.
- **Ids, not names.** Parameters reference resources by id (`team_01k…`), not
  by mutable handles, so renames never re-scope configuration.

### Extensibility

Adding a parameter means Zitadel defines, for that parameter alone:

- **Match semantics** — which part of the request context it compares against.
- **A rank in the specificity order** (rule 4 below) — inserting a tier, never
  reordering existing ones.

Because an absent parameter is no restriction (see Format), every existing
document keeps its exact meaning when a parameter is added.

### Resolution rules

1. **Empty audience is the project default.** A document with no audience
   applies project-wide. Authoring one document with no audience *is* how a
   project default is defined; there is no separate defaulting mechanism.
2. **A scoped document overrides the default wholesale.** For a matching
   request, the most specific matching document applies **entirely**. There is
   no field-level merge with the project default: a team-scoped password
   policy that omits `history_depth` gets that field's built-in default, not
   the project document's value.
3. **Parameters on one document are a conjunction.** A document matches a
   request only when **every** parameter it binds matches — the convention of
   matcher objects everywhere (keys AND, values within a key OR). So
   `{"team_ids": ["team_1"], "app_ids": ["app_1"]}` means "team-1 *through*
   app-1". A union across dimensions is expressed as separate documents, one
   per alternative.
4. **More constrained is more specific.** Among the documents matching a
   request, the winner is decided by the *set* of parameters each binds:
   a document binding a strict superset of another's parameters is more
   specific; between documents binding incomparable sets, the one binding
   the highest-ranked parameter wins. The rank is fixed by Zitadel — the
   reserved app tier above team, both above the unscoped project default —
   and a document never carries its own priority.
5. **Worked overlap example.** A request for `team-1` through `app-1`
   matching document A `{team_ids: [team_1]}`, document B
   `{app_ids: [app_1]}`, and document C
   `{team_ids: [team_1], app_ids: [app_1]}` resolves to C — it binds a
   superset. Without C, B beats A on parameter rank. Release validation
   should warn when a scoped document shadows another this way for a
   reachable combination.
6. **Same-specificity ties resolve newest-first.** Two active documents
   binding equivalent parameter sets and both matching resolve to the most
   recently created (`created_at`, then id — the shipped flow behaviour).
   For policies, release validation instead rejects two documents for the
   same operation whose audiences overlap at equal specificity, per #899's
   conflicts-rejected-at-validation requirement.
7. **Fallback strictness depends on the consumer.** Flow resolution is
   routing: hints are client-supplied suggestions, so when no better tier
   exists a scoped definition still resolves rather than failing the login.
   Policy evaluation is enforcement: a scoped policy must **never** apply
   outside its audience, and a request matching no document falls back to the
   catalogue's built-in defaults.

The shipped flow resolver (`flowAudienceScore`) predates this ADR and treats
parameters as alternatives with single-tier scoring; it must be aligned to
the conjunction semantics above. Only team hints carry real traffic today, so
the change is behaviour-neutral in practice.

### Defaults and per-audience overrides

The pattern every consumer follows: author one unscoped document as the
project default, and any number of scoped documents as overrides. A release
carries all of them; removing a scoped document restores the default for that
audience implicitly.

### Examples

The project default is the unscoped definition; an enterprise team gets an
SSO-only login by scoping a second definition to it:

```jsonc
// default-login — serves every login in the project
{
  "name": "default-login",
  "purposes": { "login": "start" },
  // no audience: project default
  "steps": [ /* identifier-first, password, passkey… */ ]
}
```

```jsonc
// acme-login — replaces the default for requests targeting team-acme
{
  "name": "acme-login",
  "purposes": { "login": "sso_only" },
  "audience": { "team_ids": ["team_01k…"] },
  "steps": [ /* SSO redirect only */ ]
}
```

A login hinting `team-acme` resolves `acme-login`; every other login resolves
`default-login`. Deleting `acme-login` restores the default for that team with
no other change.

Operation policies follow the same pattern once they land: one unscoped
`user.password.save` document as the project default, and a team-scoped
document carrying the stricter values for that team.

## Limitations compared to the traditional hierarchy

Accepted, with eyes open:

- **No restrictive inheritance at resolution.** Exactly one document applies
  (rule 2); a team-scoped password policy with `min_length: 8` fully replaces
  a project default of 15, and audience alone cannot forbid the weakening.
  It is enforceable at **release validation** instead: with the default (or a
  field of it) flagged as a floor, validation rejects a scoped document that
  weakens it — comparing *effective* documents, built-in defaults filled in,
  so omission cannot weaken silently. Strengthening the default later fails
  the next release until every scoped document catches up. This needs a
  per-control definition of "stricter", which #899 already requires each
  policy to define, and must stay opt-in — sometimes a weaker scoped
  document is the intent.
- **No delegated administration.** In the hierarchy each level is an admin
  boundary. Here the project owns everything: team-acme's own admins cannot
  author the policy scoped to team-acme — a project administrator must. Team
  self-service would need an explicit grant model, not this mechanism.
- **Effective configuration is computed, not located.** "Which password
  policy governs team-1 through app-1?" is answered by running resolution,
  not by walking up a tree, and the number of distinct effective
  configurations grows with the documents authored. Administrators need a
  "which document wins for this audience" view (#899 requires that
  visibility).
- **Overlap is invisible without validation.** Two documents both scoped
  `{"team_ids": ["team_1"]}` silently resolve newest-first (rule 6) — the
  second author may never notice the first. The hierarchy has one slot per
  node, so this conflict cannot even be expressed there; here release
  validation has to surface it.
- **Cross-parameter shadowing is silent.** An app-scoped document outranks a
  team-scoped one wherever both match (rules 4–5): team-1 requires SSO, yet
  logins through app-1 resolve app-1's document and skip the requirement.
  Conjunction gives an authored fix — a `{team_1 + app_1}` document for the
  intersection — but nothing forces authoring it; making overlapping
  documents contribute jointly is #899's composition layer, out of scope
  here.

What the model buys in exchange: it matches #899's single-owner split of
ownership and applicability, it keeps every document inside the release
lifecycle where the whole configuration is validated together, and it keeps
configuration decoupled from the containment hierarchy instead of turning
containment back into an inheritance chain. The future
models #899 sketches — default inheritance, restrictive inheritance, explicit
overrides — remain buildable per control on top of audience resolution.

## Prior art in policy-as-code products

Declared-applicability on the policy document — rather than placement in a
resource tree — is the established policy-as-code shape:

- **[OPA Gatekeeper](https://open-policy-agent.github.io/gatekeeper/website/docs/howto)** —
  a Constraint carries `spec.match` (kinds, namespaces, label selectors)
  naming what it applies to; the set of match dimensions is closed and
  engine-defined, like this ADR's parameter set. Differs in combination:
  every matching constraint applies (composition), no single winner.
- **[Kyverno](https://kyverno.io/docs/policy-types/cluster-policy/match-exclude/)** —
  policies declare `match`/`exclude` blocks over resources, namespaces, and
  subjects; same declared-applicability pattern, same compose-all-matches
  divergence.
- **[Kubernetes label selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)** —
  the matcher-object convention rule 3 adopts: keys are a conjunction, values
  within a key are alternatives.
- **[Istio AuthorizationPolicy](https://istio.io/latest/docs/reference/config/security/authorization-policy/)** —
  workload `selector` plus a fixed engine-defined precedence between policy
  kinds (`CUSTOM` > `DENY` > `ALLOW`); precedence owned by the engine, never
  by the document, like rule 4's fixed parameter rank.
- **[GitHub repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)** —
  rulesets target branches by pattern, and when several match, the strictest
  rule wins per control. The closest shipped precedent for the opt-in floor
  this ADR defers to release validation.

The single-winner, most-specific-match resolution itself (rules 2, 4) has its
precedent in longest-prefix routing and CSS specificity rather than in these
engines — the PaC products above compose all matching policies, which is
exactly the #899 composition layer this ADR leaves for later.
