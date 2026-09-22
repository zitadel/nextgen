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

## Context

### Previous Zitadel

Previous Zitadel versions scope configuration through the resource hierarchy.
A policy lives on the instance as the default, an organization overrides it,
and evaluation walks up the tree from the resource to the instance until it
finds a document. The hierarchy is both the ownership model and the
applicability model: where a policy sits decides who administers it and
which requests it governs.

### Nextgen today

Nextgen keeps the **data hierarchy**, project > team > user
([`hierarchy.md`](../design/api/hierarchy.md)), but it has no
configuration-inheritance chain. [#899](https://github.com/zitadel/nextgen/issues/899)
separates configuration **ownership** from **applicability**.

Ownership is settled: the project owns every configuration resource.

Applicability has one implementation so far, on flow definitions. A flow
definition carries an optional `audience` with `team_ids[]` and `app_ids[]`
([flow definition rules](../design/flowengine/flow-definition-rules.md)).
Empty means project default, and the resolver (`flowAudienceScore`) picks the
most specific match with app ranked above team.

The [IdP resource model](../design/idp/1-resource-model.md) went the other
way and cut `audience` from its schema, citing no identified use case: an IdP
connection is available wherever a user schema or flow step references its
slug, so its applicability is already fixed by those references.

Operation policies ([PR #1068](https://github.com/zitadel/nextgen/pull/1068))
are the next resource that needs runtime-resolved applicability, for example a
password policy for one team that is stricter than the project default. This
ADR makes the flow mechanism the general pattern: which resources it covers,
how several parameters combine, and how two documents are kept from competing
for the same request.

## Decision

**Configuration resources declare their applicability as an audience, not by
where they sit in a hierarchy.**

The audience of a configuration document is the set of requests it applies to,
declared as explicit references to project resources. It describes
applicability, not ownership. A document is either the project default or
scoped, and its audience says which; the default is never inferred from a
missing field.

The model applies to configuration that is **resolved at runtime**, meaning
the server picks which document governs an incoming request. Flow definitions
are the first case; operation policies (PR #1068) are next; any future
runtime-resolved configuration resource follows the same model.

Out of scope: configuration whose applicability is already fixed by a
reference from another resource, such as an IdP connection referenced by a
user schema.

Runtime resolution reads the documents of the release deployed to the
environment, never every active document in the project. A document outside
the deployed release cannot compete at runtime.

### Examples

Every flow definition says whether it is the project default or scoped. The
default serves every login; an enterprise team gets an SSO-only login by
scoping a second definition to it:

```jsonc
// default-login: serves every login in the project
{
  "name": "default-login",
  "purposes": { "login": "start" },
  "audience": { "default": true },
  "steps": [ /* identifier-first, password, passkey… */ ]
}
```

```jsonc
// acme-login: replaces the default for requests targeting team-acme
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

Operation policies follow the same pattern once they land: one default
`user.password.save` document, and a team-scoped document carrying the
stricter values for that team.

### Parameters

`audience` is a required object on the configuration resource. It is one of
two shapes:

- `{ "default": true }` marks the project default. It carries no other
  parameter.

  > **Note:** Leaving `audience` out, or setting it to `{}`, could mean the
  > same thing and is the convention flow definitions ship with today. It is
  > doable, but less explicit: a reader cannot tell whether an empty audience
  > applies everywhere or nowhere, and a document that forgot its audience
  > would silently become the project default. See
  > [Alternatives considered](#empty-audience-means-default).
- One or more parameters, each an array of resource ids. A request matches a
  parameter when its context value is one of the listed ids.

The parameter set is closed and Zitadel-defined; a developer picks values, not
new dimensions.

| Parameter | Matches requests… | Status |
|---|---|---|
| `team_ids[]` | targeting one of the listed teams | applicable today: shipped for flow definitions; first parameter for policies |
| `app_ids[]` | arriving through one of the listed applications | future capability |

How parameters combine:

- **Between parameters: AND.** A document matches a request only when every
  parameter it names matches. `{"team_ids": ["team_a"], "app_ids": ["app_1"]}`
  applies to requests for `team-a` *through* `app-1`, and to nothing else.
- **Within one parameter: OR.** The listed ids are alternatives, and any one
  of them matches. `{"team_ids": ["team_a", "team_b"]}` applies to requests
  for `team-a` or `team-b`, at the same specificity.

### Extensibility

Adding a parameter means Zitadel defines, for that parameter alone:

- **Match semantics**: which part of the request context it compares against.
- **A rank in the specificity order** (resolution rule 3), inserting a tier
  without reordering existing ones.

A document only binds the parameters it names, so every existing document
keeps its exact meaning when a parameter is added.

### Validation

Validation runs at two points and rejects, never warns silently. Nothing
below is decided at runtime.

**At write time**, on the single document:

- `audience` is present and has exactly one of the two valid shapes, default
  or scoped.
- Every id references an existing resource of its kind in the project. Teams
  are runtime data, not release content, so the check runs when the document
  is written. A team deleted later leaves a document that matches nothing.

**At release validation**, across every document the release pins. The
check groups the documents that could answer the same request: flow
definitions by purpose and user schema, operation policies by operation. A
definition with two purposes sits in two groups. Within a group:

- **At most one default.** Two `login` definitions both marked `default` are
  rejected; a client that starts a login by purpose alone could otherwise
  land on either. A group with no default is allowed: policies fall back to
  the catalogue's built-in values, and flows resolve whatever scoped
  definition remains (resolution rule 5), so the CLI warns on the flow case.
- **Equal-specificity overlap is rejected.** Two scoped documents are
  rejected when they bind the same parameter set with an id in common.
  Overlap at different specificity is the override pattern and stays allowed.
- **Cross-parameter shadowing is a warning.** When a document binding one
  parameter set outranks a document binding another for a reachable
  combination (the overlap example under Runtime resolution), the CLI
  reports which one wins for that combination.
- **Opt-in floors.** With a default (or a field of it) flagged as a floor,
  a scoped document that weakens it is rejected (see Limitations).

This needs the release endpoint to load each pinned revision's audience, not
only its pointer. The release is the only place the whole set is visible, so
it is the only place these conflicts can be caught before traffic.

#899 asks for conflicts to be rejected at validation for policies; this
section applies that to every consumer.

### Runtime resolution

A login starts from its purpose and the hints the client sent; a policy check
starts from its operation and the team and app of the request. From there:

1. **Candidates come from the deployed release.** Only its documents that
   serve the purpose or operation take part. Nothing else in the project is
   consulted.
2. **A document matches when every parameter it binds matches the request.**
   Keys AND, values within a key OR (see Parameters). The default matches
   every request.
3. **The most constrained match wins.** A document binding a strict superset
   of another's parameters beats it; between incomparable sets, the one
   binding the highest-ranked parameter wins. Zitadel fixes the rank, app
   above team above default, and a document never carries its own priority.
4. **The winner applies wholesale.** There is no field-level merge with the
   default: a team-scoped password policy that omits `history_depth` gets the
   built-in value for that field, not the project default's.
5. **No match is handled per consumer.** Flow resolution is routing, hints
   are client suggestions, so a scoped definition still resolves rather than
   failing the login. Policy evaluation is enforcement: a scoped policy never
   applies outside its audience, and the request falls back to the
   catalogue's built-in defaults.

With `default-login` and `acme-login` (`team_ids: [team-acme]`) in the
release, a login hinting `team-acme` matches both and `acme-login` wins on
rule 3. A login with no hints matches only `default-login`.

The overlap example: a request for `team-1` through `app-1` matching document
A `{team_ids: [team_1]}`, document B `{app_ids: [app_1]}`, and document C
`{team_ids: [team_1], app_ids: [app_1]}` resolves to C, which binds a
superset. Without C, B beats A on parameter rank.

The runtime keeps a deterministic tie-break (`created_at`, then id) purely as
a guard. A validated release never reaches it, and nothing may depend on it.

The shipped flow resolver (`flowAudienceScore`) predates this ADR: it reads
every active definition, treats parameters as alternatives, and scores a
single tier. It must be aligned to the rules above. Only team hints carry
real traffic today, so the change is behaviour-neutral in practice.

### Defaults and per-audience overrides

Every consumer follows the same pattern: author one `default` document, and
any number of scoped documents as overrides. A release carries all of them;
removing a scoped document restores the default for that audience implicitly.

## Limitations compared to the traditional hierarchy

These are accepted:

- **No restrictive inheritance at resolution.** Exactly one document applies
  (resolution rule 4): a team-scoped password policy with `min_length: 8`
  fully replaces a project default of 15, and audience alone cannot forbid
  the weakening. Release validation can, opt-in: with the default (or a field
  of it) flagged as a floor, it rejects a scoped document that weakens it.
  The comparison runs on effective documents, built-in defaults filled in,
  so omission cannot weaken silently, and strengthening the default later
  fails the next release until every scoped document catches up. It needs a
  per-control definition of "stricter", which #899 already requires each
  policy to define. It stays opt-in because a weaker scoped document is
  sometimes the intent.
- **No delegated administration.** In the hierarchy each level is an admin
  boundary. Here the project owns everything: team-acme's own admins cannot
  author the policy scoped to team-acme; a project administrator must. Team
  self-service would need an explicit grant model, which this mechanism does
  not provide.
- **Effective configuration is computed, not located.** "Which password
  policy governs team-1 through app-1?" is answered by running resolution
  rather than by walking up a tree, and the number of distinct effective
  configurations grows with the documents authored. Administrators need a
  "which document wins for this audience" view (#899 requires that
  visibility).
- **Overlap is invisible without validation.** Two documents both scoped
  `{"team_ids": ["team_1"]}` are only a conflict once they sit in the same
  release; nothing at write time stops the second author. The hierarchy has
  one slot per node, so this conflict cannot even be expressed there. Release
  validation surfaces it (see Validation).
- **Cross-parameter shadowing is silent.** An app-scoped document outranks a
  team-scoped one wherever both match (resolution rule 3): team-1 requires
  SSO, yet logins through app-1 resolve app-1's document and skip the
  requirement. Conjunction gives an authored fix, a `{team_1 + app_1}`
  document for the intersection, but nothing forces authoring it. Making
  overlapping documents contribute jointly is #899's composition layer, out
  of scope here.

In exchange, the model matches #899's single-owner split of ownership and
applicability, and it keeps every document inside the release lifecycle where
the whole configuration is validated together. Configuration stays decoupled
from the containment hierarchy instead of turning containment back into an
inheritance chain. The future models #899 sketches (default inheritance,
restrictive inheritance, explicit overrides) remain buildable per control on
top of audience resolution.

## Alternatives considered

### Empty audience means default

The shipped flow definitions use this convention: an absent `audience` applies
project-wide, and the first draft of this ADR kept it. It reads as a filter
with no terms, which is how the policy engines read it. OPA Gatekeeper
documents that "an empty matcher, a undefined `match` field, is deemed to be
inclusive (matches everything)"; Istio's reference says that "if the selector
and the targetRef are not set, the selector will match all workloads"; a
Kubernetes NetworkPolicy with `podSelector: {}` selects all pods in the
namespace.

Two things argued against it here. Those engines compose every matching
policy, so an accidental empty matcher adds a rule; in a single-winner model
it silently becomes the project default for every request. And the
convention is not stable even inside one product: the same NetworkPolicy
treats an empty `ingress` list as "allow nothing", so a reader cannot tell
from the shape alone whether empty means all or none. User-facing config
products avoid that ambiguity by naming the default:

- **[LaunchDarkly](https://launchdarkly.com/docs/home/flags/default-rule)**:
  every flag has a distinct default rule, separate from the targeting rules,
  which serves "for any contexts that don't match any of the previous
  targeting rules on the flag".
- **[Okta](https://developer.okta.com/docs/concepts/policies/)**: "a default
  policy is required and can't be deleted", and it is always the last policy
  in the priority order; new applications are assigned to it.
- **[Kubernetes IngressClass](https://kubernetes.io/docs/concepts/services-networking/ingress/#default-ingress-class)**:
  the default is opt-in through the
  `ingressclass.kubernetes.io/is-default-class: "true"` annotation, and "when
  more than one IngressClass is marked as default, the admission controller
  prevents creation of new Ingress objects that don't have an
  `ingressClassName` specified". This is the same at-most-one-default check
  the Validation section performs.

The decision follows the second group: `default: true` is explicit, and a
document without an audience fails validation instead of meaning either
"everywhere" or "nowhere".

### `default` as a top-level field outside `audience`

A sibling boolean (`"default": true` next to `"audience"`) keeps the audience
object purely a matcher. It was rejected because the two are mutually
exclusive and belong to one decision: a document is either the default or
scoped. Putting both under `audience` lets the schema express the exclusion
as a `oneOf` instead of a cross-field rule.

## Prior art

Declaring applicability on the document, instead of placing it in a resource
tree, is the established shape in both policy-as-code and platform-as-code
products.

Policy as code:

- **[OPA Gatekeeper](https://open-policy-agent.github.io/gatekeeper/website/docs/howto)**:
  a Constraint carries `spec.match` (kinds, namespaces, label selectors)
  naming what it applies to; the set of match dimensions is closed and
  engine-defined, like this ADR's parameter set. It differs in combination:
  every matching constraint applies (composition), with no single winner.
- **[Kyverno](https://kyverno.io/docs/policy-types/cluster-policy/match-exclude/)**:
  policies declare `match`/`exclude` blocks over resources, namespaces, and
  subjects; same declared-applicability pattern, same compose-all-matches
  divergence.
- **[Kubernetes label selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)**:
  the matcher-object convention rule 2 adopts: keys are a conjunction, values
  within a key are alternatives.
- **[Istio AuthorizationPolicy](https://istio.io/latest/docs/reference/config/security/authorization-policy/)**:
  workload `selector` plus a fixed engine-defined precedence between policy
  kinds (`CUSTOM` > `DENY` > `ALLOW`). The engine owns precedence, never the
  document, like rule 3's fixed parameter rank.
- **[GitHub repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)**:
  rulesets target branches by pattern, and when several match, the strictest
  rule wins per control. The closest shipped precedent for the opt-in floor
  this ADR defers to release validation.

Platform as code:

- **[LaunchDarkly targeting rules](https://launchdarkly.com/docs/home/flags/target)**:
  a flag serves a default variation ("fallthrough") unless a targeting rule
  scoped to an audience (segments, context attributes) matches. That is the
  same unscoped-default-plus-scoped-override pattern, resolved to a single
  winner. It differs on ordering: rules are author-ordered and the first
  match wins, the priority this ADR's rule 3 deliberately keeps out of
  documents.
- **[Vercel environment variables](https://vercel.com/docs/environment-variables)** /
  **[GitHub Actions environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)**:
  one variable, authored per scope (production, preview, a branch, an
  environment); the most specific scope supplies the value wholesale, and
  removing the scoped value restores the broader one. This is the exact
  default-and-override lifecycle of the Defaults section.
- **[Kustomize overlays](https://kubectl.docs.kubernetes.io/references/kustomize/glossary/#overlay)**:
  per-variant configuration layered over a shared base. The contrast case:
  overlays *patch* the base field by field, the merge model rule 4
  explicitly rejects in favour of wholesale replacement.

The single-winner, most-specific-match resolution itself (rules 3, 4) has its
precedent in longest-prefix routing and CSS specificity rather than in these
engines. The PaC products above compose all matching policies, which is
exactly the #899 composition layer this ADR leaves for later.
