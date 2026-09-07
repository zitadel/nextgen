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
same read path, same reference syntax, same ownership.

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

Four rules:

- **A value that is one placeholder and nothing else keeps the variable's
  type.** `"${{ RETRY_COUNT }}"` becomes the number `10`, not the string
  `"10"`. This is why substitution runs on the decoded document rather than on
  its text.
- **A value that wraps text around its placeholders renders into a string.**
  The surrounding text has to survive, so the variable is rendered in place:
  a string contributes itself, any other scalar contributes its JSON form.
- **A secret is referenceable only as the whole value.** `"client_secret":
  "${{ GOOGLE_CLIENT_SECRET }}"` resolves; `"a8f3c1-${{ SECRET_TAIL }}"` and
  `"${{ GOOGLE_CLIENT_SECRET }} "` are refused
  (`var.secret_not_whole_value`). The previous rule is why: an embedded
  reference renders into the string holding it, so the literal text around the
  placeholder becomes part of the resolved secret. That is a secret nobody
  entered, assembled in a document, and, for a document that is a revision,
  frozen into an immutable one; a stray trailing space produces a silently
  wrong credential with nothing to see in the source. The rule is checked
  before decryption, so a document that breaks it is refused without any secret
  being decrypted. It binds secrets only: a plain variable in a callback URL is
  the case the previous rule exists for.
- **A placeholder nothing was entered for is left standing.** A document may
  legitimately carry a reference that only resolves elsewhere, and the
  substitution pass is not the right place to decide that a deployment is
  broken. See §9 for where that decision belongs. A name nothing is held for is
  not known to be a secret either, so the rule above has nothing to say about
  it.

**There is no `vars.` / `secrets.` namespace and no `${env.X}` prefix.** Every
variable lives in one store under one flat name space, so a prefix would carry
no routing information: it would only add syntax that every author has to get
right and every reader has to strip. Whether a value is secret is a property of
the value, not of the reference to it, and the document that references it does
not change when the flag does.

### 3. The owner is the project, optionally one of its environments

A variable belongs to an owner of two levels. Only the project is required:

| Level              | Meaning                             | Required |
|--------------------|-------------------------------------|----------|
| `project_id`       | the project the variable belongs to | yes      |
| `environment_name` | one environment of that project     | no       |

An unset environment is stored as the empty string, which is the **project
level's own address** rather than a wildcard: `(project, "")` and
`(project, "prod")` are two owners, and a name may be held at both.

An earlier revision of this ADR gave the owner five levels — team, user schema
and user besides these two — and made them independent of one another. They are
gone. Nothing consumed them, the visibility and resolution rules they forced
(§4, §5) were the whole complexity of the design, and re-adding a level later is
a column and a filter term. Per-team and per-user settings will want something
of this shape; they can have it when there is a consumer to keep it honest.

### 4. Visibility: an owner reaches exactly what it entered

A read addresses one owner and returns that owner's variables. Nothing is
inherited from a broader owner and nothing is visible from a narrower one: an
environment does not see the project's variables, and the project level does not
see into its environments. A value that has to hold in several environments is
entered in each of them.

This predicate is enforced **in SQL** (`variable.VisibleTo`), and that is the
only enforcement there is: a read returns rows as scanned, so an over-admitting
filter is a leak rather than wasted IO. The domain predicate
(`VariableOwner.HasAccessTo`) exists so the two can be proven equal over every
owner combination in a test.

The project is required so that a variable belongs to something: it carries the
foreign key, and a projectless row would be owned by nobody.

An earlier revision admitted a row whose level was unset, so a project value was
readable from every environment of that project. Equality replaced it. The
inheriting form is defensible and may come back, but it is not free: it makes a
read return several rows per name, which forces a rule for choosing between them
(§5 as it was), and that rule then has to be applied identically by every reader
— a duplication that produced two readers disagreeing about the same name during
development of the API. Exact match makes the owner an address, and a name at an
address a single value.

### 5. Resolution: there is nothing to resolve

A read admits one owner and the primary key makes a name unique within it, so a
name yields at most one row. Callers key the result by name and are done.

This section previously ranked owners by specificity — summing the levels an
owner set, so that each level outweighed every level below it combined — because
a read could return one row per level. With one owner per read there is no
ranking, no ordering to get right, and no ranking function to keep two callers
agreeing on.

Reads are ordered by name, which is enough to be total, so the same owner reading
twice gets the same slice.

### 6. Storage: the natural key is the address

- **No minted id.** A variable is addressed by name and owner, never by a
  handle: there is nothing a caller could hold an id for that the natural key
  does not already name. This deviates from ADR 047, which assumes a prefixed
  opaque PK per resource. `PrefixVariable` ("var") is still registered, for
  error codes only.
- **An unset environment is the empty string, not NULL.** That keeps the natural
  key usable as a primary key, makes per-owner uniqueness enforceable without
  `NULLS NOT DISTINCT`, and matches the domain, where the unset environment is
  also `""`. Since owners are matched exactly (§4), the empty string is an
  address — the project level — and never a wildcard.
- **The primary key is the uniqueness rule.** It is what stops two variables
  existing at one name and owner, which a read would return with no rule for
  choosing between them. It is also the upsert conflict target: writing the same
  name and owner twice replaces the value in place.
- The primary key is `(name, project_id, environment_name)`.
- Reads are ordered by name, which is total within one owner, so the same owner
  reading twice gets the same slice.

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
substituted into a document, and only for a document whose secret references
all take the whole-value form of §2 -- the check runs first, so a document that
embeds one is refused with nothing decrypted.

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
not need them. The API surface is no longer among them: `GET`/`PATCH
/variables` and `GET`/`DELETE /variables/{variable_name}` address one owner per
request, taking `project_id` and an optional `environment_name`.

- **Fine-grained permissions.** The endpoints (below) sit behind the same
  project-scoped check as every other management resource, gated on
  `variable.read` / `variable.write`. Reading a secret must eventually be a
  different permission from reading a variable, and the resource has to be
  registered with the permission catalog (ADRs 032-033) for that.
- **Reading a secret back.** The API answers a secret as `{"secret": true}` and
  never with a value, which keeps this open rather than settling it. A *resolved
  document* is the other half and still contains decrypted secrets with nothing
  marking which values they are, so a caller cannot redact them from a log or a
  deploy diff. Whether secrets become write-only outright (the GitHub model, two
  mechanisms rather than one) or gain a redaction contract is undecided.
- **Whether project-level values should reach an environment.** §4 says they do
  not, so a name several environments need is entered in each of them. The
  "set it once" case has no answer yet; giving it one means either bringing back
  inheritance with a resolution rule, or a merge the caller performs over two
  reads.
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

- **A foreign key is not available while the project level is `""`.** The
  natural key needs both owner columns non-null, so "not scoped to an
  environment" is the empty string, and no environment row carries that name.
  Enforcing the reference therefore means validating on write (the
  `GetEnvironmentByName` statement already exists) rather than in the schema.
  Until that lands, a typo writes into an owner nothing will ever read from —
  and with no inheritance to fall back on (§4), what the request meant to reach
  reads as empty rather than as the project's value. That makes validating on
  write more pressing than it was, not less.
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

**An owner hierarchy** (an environment inheriting the project's variables, the
narrowest owner winning). This is what the first revision built, and §4 records
why it went: it makes a read return several rows per name, which needs a rule
for choosing between them, which every reader then has to apply the same way.
Not rejected on principle — it is the better answer for values that should hold
everywhere — but it is a rule to re-derive rather than to keep by default.

**Operating-system environment variables.** Out of scope by the issue: these are
project data, set through Zitadel, read on the environment serving the request.

## Consequences

- One table and one syntax cover per-environment configuration and the IdP
  client id/secret pair that #851 needs. Per-team and per-user settings are not
  covered; they were, on paper, and §3 says why that was dropped.
- Storage is the single enforcement point for visibility, so any future caller
  is safe by construction, and the SQL filter is proven equal to the domain
  predicate over every owner combination.
- Stored secrets survive key rotation, unlike every other ciphertext in the
  system, which is short lived by design.
- A name at an owner is one value, so there is no resolution step and no way for
  two callers to disagree about what a name holds.
- A value that must hold in several environments is entered in each of them, and
  nothing keeps those copies in step.
- A missing value ships the literal placeholder until deployment validation
  exists (§9). This is the sharpest edge in the design as it stands.
- Variables are outside releases, so a deployment is no longer fully described
  by the release it pins: two environments running one release can behave
  differently. That is the point, and it is also a new thing for an audit trail
  to cover.
