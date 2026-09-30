# ADR 066: Settings

> **Status:** Proposed
> **Date:** 2026-09-30
> **Context:** Where a setting lives, which scope configures it, and how it is
> stored, validated and read.
>
> **Scope:** settings only. Policies need their own ADR, so
> [#383](https://github.com/zitadel/nextgen/issues/383) is only partly answered and
> [#898](https://github.com/zitadel/nextgen/issues/898) stays blocked on it.
> Inheritance between scopes is deferred by
> [#899](https://github.com/zitadel/nextgen/issues/899); this ADR only avoids
> blocking it.
>
> **Builds on** [ADR 035](035-configuration-environments.md) (releases and
> deployments),
> [ADR 063](063-resource-revisions-fixed-id-and-revision-id.md) (revisions),
> [ADR 062](062-per-environment-variables-and-secrets.md) (variables),
> [ADR 008](008-users-eav-store.md) (key-value storage),
> [ADR 048](048-wide-events-internal-audit-primitive.md) (audit).

## TL;DR

- Every scope holds a settings document: deployment, project, team, user-schema,
  over built-in defaults.
- Each scope's schema defines what that scope can configure, so whether a setting is
  configurable there is a product decision.
- An unconfigured setting falls back to the deployment configuration, then the
  built-in default.
- One key-value table, a row per property path, immutable and discriminated by a
  `revisionID` that a release pins.
- A value may be a variable reference, which is how a setting varies per environment,
  at the cost of validating only at deployment.

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
authentication methods are allowed. Each layer describes its own settings-schema
defining what values can be configured.

### 2. Storage

All settings are stored in a single table as a key-value store similar to the 
KV-store of users. All properties are saved as individual entries with as key
the path to the property and value is the value of the property. Lists are 
stored as a whole. Next to lists, JSON scalar values are the only supported
types since objects will be broken into separate rows.

An object whose keys are data rather than schema is stored whole like a list, because
`password_hasher.hasher.params` is valid only as a set for one algorithm.

This storage method will require the scope on which the setting is applicable 
(`projectID`, `teamID`, `userSchemaID`). All these entries need to be immutable
to work with revisioning system described in ADR063. This will make writes
expensive since all data in a document will need to be duplicated when one
property changes. This is done because we want to optimise for reads rather
than writes and later on when configuration overriding lands, this will help
with resolving settings.

### 3. Revisions

To enable revisions a `revisionID` is added to JSON document. However, because
each property lives in a separate record in the database, each record will need
the `revisionID` as a discriminator.

### 4. Variables

To make configuration flexible over environments, a variable can be used to
describe the value of a setting. This does not come without cost though: since
variables cannot be evaluated without an environment, validation cannot be done
until a deployment happens (which links a release and an environment).

A missing variable fails that deployment. ADR 062 leaves an unresolved reference
literal, which is fine for a string an IdP rejects and wrong for a duration.

### 5. Validation and reads

A value outside the bound its deployment field declares is refused, not clamped, as
the password hasher already does with a method outside its limits.

An unconfigured setting is not a failure: the value comes from the deployment
configuration or the built-in default. An invalid value or an unresolved reference
refuses the operation instead, and never falls back to one.

A read reports the scope the value came from, which #899 requires and which is where
"inherited" would go later.

### 6. One accessor, in the service layer

Not in API handlers, because the flow engine drives `auth_attempts` through the
internal Go service layer rather than over HTTP, so a handler-level read is
invisible to the hosted login. Not in storage, which lacks request context. The
service layer is the chokepoint the hosted login, direct clients, administration
and self-service all pass through.

### 7. Audit

A release emits one ADR 048 wide event per property whose value differs from the
release the environment runs, carrying the path, the scope and both values. The
release and deployment already record `created_by`, `message` and `git_sha`. A
variable reference is recorded unresolved, so a secret never lands in an event.

### 8. What is not a setting

| Not a setting                 | Where it stays              | Why                                                                           |
|-------------------------------|-----------------------------|-------------------------------------------------------------------------------|
| The deployment-only subtrees  | Viper                       | Not overridable, not promotable between environments                          |
| Authorization rules           | ADR 032 / 033 / 034         | "May this principal act" is a different question with a rule language already |
| User state                    | User data, outside releases | #899 draws this line                                                          |
| Branding, templates, copy     | ADR 040 / 045 / 057         | Documents, not fields in a config tree                                        |
| A user's own attributes       | The schema and the user     | A schema configures settings (§1), but what it describes is user data         |
| A requirement on an operation | Nowhere yet                 | That is a policy, out of scope                                                |

## Alternatives considered

**Settings in the `variables` table under a reserved `zitadel.` namespace.**
Rejected: settings are revisioned (§3) and variables are not, by design, because a
per-environment value cannot travel inside a release unchanged. What survived the
exploration: list and object values (§2), and variable references (§4).

**One opaque document per scope, as idp connections and branding store.** Rejected
(§2): settings are read one property at a time, and "which projects override this
path" stops being portable SQL.

**Another column on `projects`, as `password_hash_policy` is.** Rejected: no
revisions, no release, no scope but the project, a migration per setting.

## Non-goals

Policies; inheritance between scopes; the per-setting specifications, each of which
states its scopes, its default and what a promoted change does to existing state; the
HTTP shape of the effective-configuration read; release approval mechanics; retention
of superseded revisions.

## Consequences

**`password_hash_policy` stops being a column** and becomes a project-scoped setting
bounded by `HashConfig.Limits`. The migration is a follow-up, and it removes the last
runtime-mutable configuration from outside the release boundary.

**`session.default_ttl` becomes configurable** below the deployment, bounded by
`max_ttl`. A behaviour change for self-hosters, needing its own issue.

**Writes are expensive by design,** which is §2's trade for cheap reads.

**No setting changes without a release,** which is what makes a change promotable and
attributable. A value that must move per environment is a variable reference.

## Open questions

- Which scopes each setting allows. First cases are `session.default_ttl` and the
  password hasher.
- Whether `x-auth-methods` folds into the user-schema settings document.
- Whether a deployment may refuse a change that invalidates existing users,
  credentials or sessions, or only warn (ADR 035's deployment validation).
- Whether the deployment configuration is readable through the API, so an
  administrator sees the bounds.
- Which team instance applies when an operation targets one. ADR 060 keys sessions on
  `users.lifecycle_owner_team_id` rather than roster membership, for the cardinality
  reason that applies here too.
