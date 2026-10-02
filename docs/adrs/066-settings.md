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
> blocking it. The per-setting specifications (scopes, default, effect of a
> promoted change on existing state) are follow-ups.
>
> **Builds on** [ADR 035](035-configuration-environments.md) (releases and
> deployments),
> [ADR 063](063-resource-revisions-fixed-id-and-revision-id.md) (revisions),
> [ADR 062](062-per-environment-variables-and-secrets.md) (variables),
> [ADR 008](008-users-eav-store.md) (key-value storage),
> [ADR 024](024-user-team-lifecycle-ownership.md) and
> [the API hierarchy](../design/api/hierarchy.md) (owners),
> [ADR 048](048-wide-events-internal-audit-primitive.md) (audit).

## TL;DR

- Settings are project-owned first. The system configuration (`config.yaml`)
  provides the fallback values and the bounds; team and user-schema scopes are
  left room for, not built.
- An unconfigured setting falls back to the system configuration, then the
  built-in default.
- One key-value table, a row per property path, immutable and discriminated by a
  `revision_id` that a release pins.
- A value may be a variable reference, which is how a setting varies per environment,
  at the cost of validating only at deployment.

## Context

`cmd/server/config.go` holds every configurable thing the server has. Only
`session` (`default_ttl`, `max_ttl`) and `password_hasher` (`crypto.HashConfig`,
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md)) are meant to differ below the system; the rest
is system-only.

That leaves one idea with two mechanisms and two gaps. `session.default_ttl` is
system-wide with no way for a project to differ, which #899 names as a setting.
`password_hash_policy` (the `password_hash` API field) is a column mutated outside ADR 035's release boundary, so it
is neither promotable nor attributable. Every further setting picks one of the two
and inherits its gap.

## Decision

### 1. Scopes

Settings can be configured in these scopes:

- **built-in defaults**: the defaults in Go code (Viper's defaults today). A setting
  without a built-in default must be set in the system configuration, or the server
  refuses to start.
- **system**: the installation's `config.yaml`, read by Viper. It is never stored in
  the settings table and never pinned by a release; it only provides fallback values
  and the bounds a lower scope must stay within.
- **project**: a settings document, part of the project's release. This is the only
  stored scope in the first implementation.


Team, application (#899) and user-schema scopes are left room for but not built
without a concrete use case. A user schema already carries
`x-auth-methods`, which stays where it is; whether it folds into a settings document
is an open question.

Each scope's schema declares what it can configure, so whether a setting is
configurable in a scope is a product decision.

Falling back to the system configuration or a built-in default is not inheritance:
no stored scope overrides another one until #899 is decided.

### 2. Storage

All settings are stored in a single table as a key-value store similar to the
KV-store of users. All properties are saved as individual entries with as key
the path to the property and value is the value of the property. Lists are
stored as a whole. Next to lists, JSON scalar values are the only supported
types since objects will be broken into separate rows.

An object whose keys are data rather than schema is stored whole like a list, because
`password_hasher.hasher.params` is valid only as a set for one algorithm.

Which objects are stored whole is read from the settings schema: arrays, and objects
whose keys are not declared properties (`additionalProperties`).

A settings document is a revisioned resource
([ADR 063](063-resource-revisions-fixed-id-and-revision-id.md)): one per owner, with a
fixed `id` and a `revision_id` per revision, pinned by a release like any other kind.
Each row carries the owner (`project_id` now; a scope-kind column joins it when a
second scope lands), the `revision_id` and the path, and `(project_id, revision_id,
path)` is unique. Rows are immutable, so a change duplicates the whole document under a new
`revision_id`. Writes are expensive by design: we optimise for reads, and once
overriding lands it simplifies resolving settings.

### 3. Variables

To make configuration flexible over environments, a variable can be used to
describe the value of a setting. This does not come without cost though: since
variables cannot be evaluated without an environment, validation cannot be done
until a deployment happens (which links a release and an environment).

Changing a variable does not change the release. It takes effect with a new
deployment of the same release with the updated variables, and is validated then;
a rollback is a deployment of the previous variables. Deployment-time validation is
deferred by ADR 062 and has to land with this.

A missing variable follows ADR 062: the reference is rendered as is. For a settings
value that then fails validation (§4) unless the literal is valid for the setting.

### 4. Validation and reads

A value outside the bound the system configuration declares is refused, not
clamped, as the password hasher already does with a method outside its limits.

A setting is configured when the release's pinned settings revision holds a row for
its path. An unconfigured setting is not a failure: the value comes from the system
configuration or the built-in default. An invalid value refuses the operation
instead, and never falls back.

This fallback is fail-open: a release that drops a value, or pins no settings
revision at all, silently gets the system value, which can be weaker than what the
project had. How security-relevant settings guard against that is an open question.

A read reports the scope the value came from, which #899 requires and which is where
"inherited" would go later.

### 5. One accessor, in the service layer

Not in API handlers, because the flow engine drives `auth_attempts` through the
internal Go service layer rather than over HTTP, so a handler-level read is
invisible to the hosted login. Not in storage, which lacks request context. The
service layer is the chokepoint the hosted login, direct clients, administration
and self-service all pass through.

Every read of a setting goes through that accessor, which resolves the scope and the
fallback. Handlers and flow steps never read the settings table directly.

Changing a setting is creating and deploying a release, so it needs the permissions
ADR 035 already requires for those.

A promoted change applies to what is created after it: sessions and credentials that
exist keep what they were created with, unless the per-setting specification says
otherwise.

### 6. Audit

Changes are audited through the release (ADR 035, ADR 048). A variable reference is
recorded unresolved, so a secret never lands in an event.

### 7. What is not a setting

The system-only subtrees, authorization (ADR 032 to 034), branding and copy
(ADR 040, 045, 057), user state and policies.

## Alternatives considered

**Settings in the `variables` table under a reserved `zitadel.` namespace.**
Rejected: settings are revisioned and variables are not, by design.

**One opaque document per scope, as IdP connections and branding store.** Rejected:
settings are read one property at a time.

## Consequences

**`password_hash_policy` stops being a column** and becomes a project-scoped setting
bounded by `HashConfig.Limits`. The migration is a follow-up, and it removes the last
runtime-mutable configuration from outside the release boundary.

**`session.default_ttl` becomes configurable** per project, bounded by `max_ttl`,
which stays system-only. A behaviour change for self-hosters, needing its own issue.

## Open questions

- Whether `x-auth-methods` folds into a settings document.
- How security-relevant settings avoid the fail-open fallback (§4): refuse a
  deployment whose release drops a value the previous one held, or require the system
  value to be at least as strict as the bound.
- The password hasher in environments that share user data (preview environments):
  a different hasher per environment can lock users out, so whether it may vary per
  environment, and where `Verifiers` lives. The same holds for rollback: users
  rehashed after a promotion (ADR 038) must stay verifiable when the previous
  revision is deployed again.
- Whether a deployment may refuse a change that invalidates existing users,
  credentials or sessions, or only warn.
- Whether the system configuration and the built-in defaults are readable through
  the API, so an administrator sees the bounds and the effective value.
