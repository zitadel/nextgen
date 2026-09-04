# ADR 061: Per-Environment Variables and Secrets

> **Status:** Proposed
> **Date:** 2026-09-04
> **Context:** How a configuration value that must differ per environment
> reaches a running release, and how the sensitive half of those values is
> protected.
>
> Outcome of [#967](https://github.com/zitadel/nextgen/issues/967) (Environments
> - Variables), part of [#528](https://github.com/zitadel/nextgen/issues/528).
>   Unblocks [#851](https://github.com/zitadel/nextgen/issues/851) (IdP
>   connections), which is the first consumer.
>
> **Builds on** [ADR 035](035-configuration-environments.md) (a release is
> promoted between environments unchanged; environments are runtime slots),
> [ADR 029](029-cryptography-secrets-and-key-lifecycle.md) (envelope encryption,
> per-project keys), [ADR 028](028-storage-v2-statements-and-dialects.md) and
> [ADR 041](041-storage-statement-contract-tests.md) (statements per dialect,
> shared contract tests).
>
> **Deviates from** [ADR 047](047-dialect-id-generation.md) §Prefix registry: a
> variable has no minted PK (§6).

## Context

A release pins a revision of every configuration resource and is deployed to any
environment unchanged (ADR 035). A value that has to differ per environment
therefore cannot live inside the release, and there is nowhere else for it to
go today.

IdP connections are the first case that cannot be expressed at all. A project
registers a separate OAuth client per environment, so both the client id and the
client secret differ between them: one public, one sensitive, both required
before the connection can be used. `docs/design/idp/schemas/github.json` shows
the shape the resource wants:

```json
{
  "client_id": "${{ GITHUB_CLIENT_ID }}",
  "client_secret": "${{ GITHUB_CLIENT_SECRET }}"
}
```

These are **not** operating-system environment variables. They are values the
developer sets on their own project's environments, stored there, and resolved
when a request is served on that environment. GitHub Actions is the closest
parallel: a repository declares environments, each holding its own values, and
one unchanged workflow reads them per environment.

## Decision

A **variable** is a named value entered by an owner, stored once, and
substituted into configuration documents when they are served. Sensitive and
non-sensitive values are one mechanism, separated by a flag on the row.

### 1. One resource, one storage, two flavours

A variable is `(name, owner, value, is_secret)`. A secret is a variable whose
value is stored encrypted; everything else about it is identical: same table,
same read path, same reference syntax, same resolution rule.

Values are JSON scalars: a string, a bool, or a number. The value travels
through JSON in both directions, so the set of types is JSON's, and a number
always reads back as a `float64` however it was written. A type JSON has no
scalar for (a timestamp, say) is rejected at construction rather than quietly
coming back as the string it serialized to.

A name is `^\w+$`, which is exactly what the reference syntax below can address.

### 2. `${{ NAME }}` references, with no namespace

A configuration document references a variable by placeholder:

```json
{
  "client_id": "${{ GITHUB_CLIENT_ID }}",
  "callback": "https://${{ HOST }}/callback"
}
```

Three rules:

- **A value that is one placeholder and nothing else keeps the variable's
  type.** `"${{ RETRY_COUNT }}"` becomes the number `10`, not the string
  `"10"`. This is why substitution runs on the decoded document rather than on
  its text.
- **A value that wraps text around its placeholders renders into a string.**
  The surrounding text has to survive, so the variable is rendered in place:
  a string contributes itself, any other scalar contributes its JSON form.
- **A placeholder nothing was entered for is left standing.** A document may
  legitimately carry a reference that only resolves elsewhere, and the
  substitution pass is not the right place to decide that a deployment is
  broken. See §9 for where that decision belongs.

**There is no `vars.` / `secrets.` namespace and no `${env.X}` prefix.** Every
variable lives in one store under one flat name space, so a prefix would carry
no routing information: it would only add syntax that every author has to get
right and every reader has to strip. Whether a value is secret is a property of
the value, not of the reference to it, and the document that references it does
not change when the flag does.

### 3. The owner is a set of independent levels

A variable belongs to an owner made of five levels. Only the project is
required; the rest are independent of one another, so any combination is valid:

| Level              | Meaning                             | Required |
|--------------------|-------------------------------------|----------|
| `project_id`       | the project the variable belongs to | yes      |
| `environment_name` | one environment of that project     | no       |
| `team_id`          | one team                            | no       |
| `user_schema_id`   | every user of one schema            | no       |
| `user_id`          | one user                            | no       |

A variable can belong to a user in a team of a project without naming an
environment or a user schema. The levels are **not** a prefix chain: nothing
requires the level above it to be set.

The issue asks only for per-environment values, and environment is the level
that answers it. The other three are here deliberately: per-team, per-schema and
per-user settings are the same shape (a value entered at a scope, read by
whoever falls inside it), and settings are expected to move onto this structure
rather than grow a parallel one.

### 4. Visibility: unset means inherited, set means own branch

A requester carries the same five-level owner. A variable is visible when, for
every level, the variable's id is either unset (the variable is owned further
up, so it is inherited) or equal to the requester's (the variable is on the
requester's own branch). A requester that is itself unset at a level can only
read variables that are unset there.

This predicate is enforced **in SQL** (`variable.VisibleTo`), and that is the
only enforcement there is: a read returns rows as scanned, so an over-admitting
filter is a leak rather than wasted IO. The domain predicate (`VariableOwner.HasAccessTo`)
exists so the two can be proven equal over every owner combination in a test.

The project is required for the same reason: an unset level reads as a wildcard,
so a variable with no project would be visible from every project.

### 5. Resolution: the narrowest level wins

Storage never collapses rows. A name entered at several owners returns one row
per owner, and choosing between them is a domain decision, made by ranking the
owners.

An owner's rank is the sum of the levels it sets. Each level outweighs every
level below it combined, so this is a lexicographic comparison from the
narrowest level down: a value entered for one user beats a value entered for a
whole team, however many broader levels that team-level owner also names.
Counting levels instead would make `{project, environment, team}` beat
`{project, user}`, which inverts the intent.

Ranking, not containment, is what makes this total: two owners neither of which
contains the other (`{project, environment}` and `{project, user}`) can both be
visible to one requester, so "most specific" has to be an order, not a partial
one.

### 6. Storage: the natural key is the address

- **No minted id.** A variable is addressed by name and owner, never by a
  handle: there is nothing a caller could hold an id for that the natural key
  does not already name. This deviates from ADR 047, which assumes a prefixed
  opaque PK per resource. `PrefixVariable` ("var") is still registered, for
  error codes only.
- **Unset levels are the empty string, not NULL.** That keeps the natural key
  usable as a primary key, makes per-owner uniqueness enforceable without
  `NULLS NOT DISTINCT`, and matches the domain, where an unset owner id is also
  `""`.
- **The primary key is the uniqueness rule.** It is what stops two variables
  existing at one name and owner, which a read would return with no rule for
  choosing between them. It is also the upsert conflict target: writing the same
  name and owner twice replaces the value in place.
- Reads are ordered by name then owner columns, broadest first, so the same
  requester reading twice gets the same slice.

### 7. Secrets are encrypted per project and decrypted by the key that wrote them

A secret's value is JSON-marshalled and encrypted with the project's active
`secret` encryption key (ADR 029 envelope encryption), so the plaintext never
reaches the row.

Decryption resolves the key **named in the value's own JWE header**, not
whatever key is active at read time. A variable outlives the key that was active
when it was written, unlike a cookie or a token whose ciphertext is short lived,
so reaching for the active key would make every stored secret unreadable the
first time a project's secret key is rotated. Key lookups are memoized per
document, since one document usually holds several secrets under one key.

Reads return the ciphertext. Decryption happens only where a value is being
substituted into a document.

### 8. Bounded expansion

Three limits keep one small document from rendering an enormous response, and
one in-memory document from recursing forever:

| Limit            | Value              | Why                                                                                      |
|------------------|--------------------|------------------------------------------------------------------------------------------|
| Value size       | 16 KiB per string  | a variable is a config value, not a payload                                              |
| Expansion budget | 1 MiB per document | nothing caps how many places reference one name                                          |
| Document depth   | 20                 | a document built in memory can contain itself; one that arrived as JSON is far shallower |

### 9. What this ADR does not decide

Deliberately left open, because they are separable and the first consumer does
not need them:

- **Who may read what.** There is no authorization on variables yet. Reading a
  secret must eventually be a different permission from reading a variable, and
  the resource has to be registered with the permission catalog (ADRs 032-033)
  before an API exists.
- **The API surface.** Error schemas (`api/openapi/.../errors/var-*.yaml`) are
  defined; endpoints are not.
- **Reading a secret back.** A resolved document currently contains decrypted
  secrets with nothing marking which values they are, so a caller cannot redact
  them from a log or a deploy diff. Whether secrets become write-only (the
  GitHub model, two mechanisms rather than one) or stay readable with a
  redaction contract is open.
- **What a deployment does when a referenced value is missing.** §2 leaves an
  unresolved placeholder standing, which is the right behavior for the
  substitution pass and the wrong one for a deploy. Validating a release against
  a target environment before it goes live belongs with deployments (ADR 035),
  not here.

## The environment level is a name, and the name is not enforced

Environments landed as a resource while this was being written (#532): a project
holds environments of `(project_id, id, name)`, the name is unique per project,
addresses the resource on the wire (`GET /environments/{name}`), and is validated
as a lowercase DNS-style label of at most 63 characters.

A variable scopes to that **name** rather than to the environment id, which
matches how an environment is addressed everywhere else, keeps a variable
readable by a request that knows only which environment it is serving, and keeps
the owner tuple a tuple of strings.

The name is currently **not checked** on the way in. Two things follow, and
neither is decided here:

- **A foreign key is not available while an unset level is `""`.** The natural
  key needs every owner column non-null, so "not scoped to an environment" is
  the empty string, and no environment row carries that name. Enforcing the
  reference therefore means validating on write (the
  `GetEnvironmentByName` statement already exists) rather than in the schema.
  Until that lands, a typo scopes a variable into invisibility rather than
  failing.
- **Renaming or deleting an environment does not touch its variables.** They
  keep pointing at a name nothing answers to. Whichever way that is settled
  (cascade on the name, forbid the rename, or leave the variables orphaned by
  design), it belongs with the environment lifecycle rather than here.

## Alternatives considered

**A field-name twin per referencing field** (`client_secret_env` beside
`client_secret`, as sketched in #967). Rejected: every field that might
reference a value needs a second field, the schema doubles, and a value can only
be referenced where someone anticipated it.

**Namespaced references** (`${{ secrets.X }}` / `${{ vars.X }}`, or
`${env.X}`). Rejected: with one store and one flat name space the prefix routes
nothing, and it makes the reference depend on a flag that belongs to the value.
Note the cost: a document author cannot see from the reference whether a value
is sensitive, and the name grammar (`\w+`) would have to widen before a
namespace could be adopted later.

**Separate mechanisms for secrets and variables.** Deferred rather than
rejected: it is the honest answer to read-back and deploy diffs (§9), but it
doubles the surface before there is an API to double, and the encryption flag
already gives the two different storage behavior.

**Per-environment values inside the release.** Impossible under ADR 035: a
release is promoted between environments unchanged, so anything inside it is by
definition the same everywhere.

**A strict owner chain** (each level requiring the one above). Rejected: it
cannot express "this user in this team" without inventing an environment and a
user schema for them, and it makes the resolution rule a depth comparison that
silently misranks owners once the chain is not a chain.

**Operating-system environment variables.** Out of scope by the issue: these are
project data, set through Zitadel, read on the environment serving the request.

## Consequences

- One table and one syntax cover per-environment configuration, per-team
  settings, and the IdP client id/secret pair that #851 needs.
- Storage is the single enforcement point for visibility, so any future caller
  is safe by construction, and the SQL filter is proven equal to the domain
  predicate over every owner combination.
- Stored secrets survive key rotation, unlike every other ciphertext in the
  system, which is short lived by design.
- Resolution is total and order-independent: the same set of rows always
  collapses to the same value.
- A missing value ships the literal placeholder until deployment validation
  exists (§9). This is the sharpest edge in the design as it stands.
- Variables are outside releases, so a deployment is no longer fully described
  by the release it pins: two environments running one release can behave
  differently. That is the point, and it is also a new thing for an audit trail
  to cover.
