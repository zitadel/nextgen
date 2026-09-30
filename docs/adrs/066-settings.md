# ADR 066: Settings

> **Status:** Proposed
> **Date:** 2026-09-30
> **Context:** Settings are the overridable subtree of the server configuration,
> layered across deployment, project, team and user schema, stored as field rows
> carried by a release.
>
> **Scope:** settings only. Policies are deferred
> ([below](#deferred-the-policy-layer)), so
> [#383](https://github.com/zitadel/nextgen/issues/383) is only partly answered.
>
> **Needs product sign-off:** layered override is the mechanism here from day one,
> while [#899](https://github.com/zitadel/nextgen/issues/899) specifies one
> explicit owner and defers inheritance. See
> [Why layering now](#why-layering-now).
>
> **Builds on** the meta-schema pipeline (`scripts/generate-meta-schemas.ts`),
> [ADR 035](035-configuration-environments.md) (releases, environments,
> deployments), [ADR 062](062-per-environment-variables-and-secrets.md)
> (per-environment values are variables, attached to the environment),
> [ADR 048](048-wide-events-internal-audit-primitive.md) (audit),
> [ADR 024](024-user-team-lifecycle-ownership.md) (users and credentials are
> project-scoped).
>
> **Deviates from** [ADR 063](063-resource-revisions-fixed-id-and-revision-id.md):
> a setting mints no `id` and no `revision_id` of its own, because the release
> carries its content and supplies its version (§9). It still *references* one, the
> `revision_id` of the schema whose layer defines it (§2).

## TL;DR

- Settings **are** the overridable subtree of `cmd/server/config.go` (`session`,
  `password_hasher`; the rest is deployment-only), so there is no key namespace to
  invent. A setting is a path in that tree.
- The shape is generated from the OpenAPI YAML by the existing meta-schema
  pipeline, reaching the Go validator, the API and the developer's editor from one
  source.
- Four layers: deployment, project, team, user schema. Each holds a **sparse**
  document, and an unset field falls through.
- `x-layers` declares per field which layers may set it, **ordered, last wins**,
  so precedence where layers do not contain each other is a per-field product
  decision.
- Only the deployment layer carries bounds beside values. Out of bounds is
  rejected, never clamped.
- **Settings are release content.** One table of field rows keyed by
  `release_id`, so promotion, rollback and `git_sha` attribution come from
  ADR 035 for free, and changing a setting requires a release.
- Per-environment variation is a variable reference inside a setting value, since
  variables are what attach to an environment.
- Fail-closed: missing falls through, invalid or out of bounds refuses the
  operation.

## Context

`cmd/server/config.go` already holds every configurable thing the server has, and
splits along one line nothing marks:

|                                      | Subtrees                                                                                                                                           |
|--------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| **Deployment only**                  | `server`, `database`, `keys`, `instrumentation`, `platform`, `events`, `httpclient` (egress, [ADR 061](061-egress-policy-user-injectable-urls.md)) |
| **Overridable below the deployment** | `session` (`default_ttl`, `max_ttl`), `password_hasher` (`crypto.HashConfig`)                                                                      |

The overridable half already has the layered shape in one place: `crypto.HashConfig`
separates `Hasher` (the deployment's value), `Limits` (bounds on what a project may
choose) and `Verifiers` (what it can still read), and the project's override is a
`password_hash_policy` column set by `PATCH`.

That leaves one idea with two mechanisms and two gaps. `session.default_ttl` is
deployment-wide with no way for a project to differ, which #899 names as a setting.
`password_hash_policy` is a column mutated outside ADR 035's release boundary, so it
is neither promotable nor attributable. Every further setting picks one of the two
and inherits its gap.

## Decision

### 1. Each scope has a settings-document

The application has multiple scopes in which settings can be configured:

- (defaults)
- deployment
- project
- team
- user-schema

Each of these layers should be able to configure parts of the application. This
will be done using a JSON/YAML document.

E.g.: the deployment holds a `config.yaml` which defines the instrumentation, 
events, the database,... A project will contain a JSON-document which defines 
the password-hashing policy for that project. But a user-schema defines which
authentication methods are allowed.

### 2. Storage

All settings are stored in a single table as a key-value store similar to the 
KV-store of users. All properties are saved as individual entries with as key
the path to the property and value is the value of the property. Lists are 
stored as a whole. Next to lists, JSON scalar values are the only supported
types since objects will be broken into separate rows.

This storage method will require the scope on which the setting is applicable
(`projectID`, `teamID`, `userSchemaID`). All these entries need to be immutable
to work with revisioning system described in ADR063. This will make writes 
expensive since all data in a document will need to be duplicated when one 
property changes. This is done because we want to optimise for reads rather
than writes and later on when configuration overriding lands, this will help
with resolving settings.

### 3. Variables

To make configuration flexible over environments, a variable can be used to 
describe the value of a setting. This does not come without cost though: since
variables cannot be evaluated without an environment, validation cannot be done
until a deployment happens (which links a release and an environment).

### 3. One accessor, in the service layer

Not in API handlers, because the flow engine drives `auth_attempts` through the
internal Go service layer rather than over HTTP, so a handler-level read is
invisible to the hosted login. Not in storage, which lacks request context. The
service layer is the chokepoint the hosted login, direct clients, administration
and self-service all pass through.

### 4. What is not a setting

| Not a setting                 | Where it stays              | Why                                                                           |
|-------------------------------|-----------------------------|-------------------------------------------------------------------------------|
| The deployment-only subtrees  | Viper                       | Not overridable, not promotable between environments                          |
| Authorization rules           | ADR 032 / 033 / 034         | "May this principal act" is a different question with a rule language already |
| User state                    | User data, outside releases | #899 draws this line                                                          |
| Branding, templates, copy     | ADR 040 / 045 / 057         | Documents, not fields in a config tree                                        |
| A user's own attributes       | The schema and the user     | The schema is a layer (§2), but what it describes is user data                |
| A requirement on an operation | Nowhere yet                 | That is a policy, deferred below                                              |

## Alternatives considered

**Settings stored in the `variables` table under a reserved `zitadel.` namespace,
sharing that store, its API and its substitution machinery.** Explored at length and
rejected on one point: a setting defined by a user schema is part of that schema's
content, so it is versioned by the schema revision (§2). Variables have no revisions
by design, and giving them any would break the reason they exist, which is that a
per-environment value cannot travel inside a release unchanged (ADR 062). Adding
revisions to only the reserved rows is this table behind a discriminator. What
survives from that exploration: values may be arrays and objects (§9), and a
setting's value may be a variable reference, which is how a setting varies per
environment.

**A separate registry of setting keys declared in Go.** Rejected (§1): the
overridable config subtree is already the key set, and the meta-schema generator
already reaches the server, the API and the editor.

**One opaque document per release, as idp connections and branding store.**
Rejected (§9) on the read path: settings are read one path at a time across
layers, and "which projects override this path" stops being portable SQL.

**Storing schema-scoped settings inside the schema document, as `x-auth-methods`
does.** Rejected (§2) while the schema layer is accepted: user records pin a schema
`revision_id` (ADR 063 §5) and a flow definition names its own schema pointer, so a
value stored there is read at different revisions on different paths.

**Another column on `projects`, as `password_hash_policy` is.** Rejected: no
revisions, no release, no non-project layer, a migration per setting. It is the
status quo.

## Non-goals

Policies and their composition; restrictive inheritance; the per-field
specifications, each needing its annotations plus `x-on-promotion`; the concrete
HTTP shape of `effective-configuration`; release approval mechanics (out of scope in
ADR 035); retention of superseded releases.

## Consequences

**`password_hash_policy` stops being a column** and becomes a project-layer field
bounded by `HashConfig.Limits`, carried by a release. The current endpoint keeps
working until then; the migration is a tracked follow-up and removes the last
runtime-mutable configuration from outside the release boundary. Its
`x-on-promotion` is documented behaviour already: stored passwords keep verifying
under the method they were written with.

**`session.default_ttl` becomes overridable** below the deployment, bounded by
`max_ttl`. It is also the first field whose `x-layers` order is a real product
decision. A behaviour change for self-hosters, needing its own issue.

**No setting changes without a release.** Operators who expect to adjust a lifetime
in a console field will instead cut a release. That is deliberate: it is what makes
a setting change promotable, reversible and attributable. A value that genuinely has
to move without one is a variable reference, resolved per environment.

**The overridable subtree becomes a contract.** Splitting `Config` and generating
its overridable half makes a change there an API change, not a local struct edit.

## Open questions

- **Precedence between user schema and team,** where no containment orders them.
  `x-layers` makes it a per-field declaration, so the decision is a product one and
  the first case is `session.default_ttl`.
- **Whether `x-on-promotion` can refuse a deployment** that would invalidate
  existing state, or only warn. Belongs with ADR 035's deployment validation.
- **Whether the deployment layer is readable through the API,** so an administrator
  can see the bounds their choices sit inside.
- **Which team instance applies** when the operation targets one. ADR 060 keys
  sessions on `users.lifecycle_owner_team_id` rather than roster membership, for
  the cardinality reason that applies here too; that contract still has to be
  written down.
