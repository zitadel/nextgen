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

A **variable** is a named value entered by an owner and stored once, read by
name or substituted into configuration documents when they are served.
Sensitive and non-sensitive values are one mechanism, separated by a flag on
the row.

### Scope: what this decides, and what it deliberately leaves

The smallest thing that carries the first consumer. Everything below the line
is a separate decision with its own trigger, not an implementation detail of
this one — none of it should be built before something needs it, and each is
sized to be added without reworking what is here.

**Decided here:**

- The resource: `(name, owner, value, is_secret)`, owned by a project and
  optionally one of its environments (§1, §3).
- `${{ NAME }}` references and the four substitution rules (§2).
- Owners are addresses, matched exactly, with no inheritance between them —
  which is what leaves nothing to resolve (§4, §5).
- Storage: the natural key is the address, no minted id (§6).
- Secrets encrypted with the project's own key, decrypted by the key that wrote
  them, and reached by name rather than by resolving a whole document (§7).
- Bounded expansion (§8).
- Runtime integration: never resolved on write, read per use case at the point
  of use, with domain objects carrying references rather than values (§9).
- The management API: `GET`/`PATCH /variables` and `GET`/`DELETE
  /variables/{variable_name}`, gated on `variable.read` / `variable.write`
  behind the same project-scoped check as every other management resource.
  A secret never reads back.

**Deferred, each with what would trigger it:**

| Deferred | Trigger |
|---|---|
| More owner levels: team, user schema, user | A consumer that also answers what should happen when two of them hold one name. Adding a level is a column and a filter term; agreeing its precedence is the work (§3). |
| Whether a project value should reach an environment — the "set it once" case | A product decision. Today every environment holds its own copy and nothing keeps those copies in step (§4, §10). |
| A permission for writing or reading a *secret*, distinct from a variable | Registering the resource with the permission catalog (ADRs 032–033). Until then, whoever may edit a project's configuration may write its secrets (§10). |
| Whether a secret can ever be read back at all | A decision between write-only outright (the GitHub model) and readable under a redaction contract. The API withholds the value today rather than settling it (§7, §10). |
| Marking, or refusing, secrets inside a resolved document | The redaction contract. Fetching by name already keeps the marking; substitution loses it (§7, §10). |
| Validating that a target environment resolves every reference before a deployment goes live | Deployments (ADR 035). Until then an unresolved reference ships as its own literal text (§2, §10). |
| What a *rename* of an environment does to the variables scoped to it | Environment lifecycle. Nothing renames an environment today, and the foreign key below refuses one while variables point at the old name, so the question is posed rather than answered. |

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
  broken. See §10 for where that decision belongs. A name nothing is held for is
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

Two levels, and no more. Team, user-schema and user levels are the obvious next
ones — per-team and per-user settings are the same shape, a value entered at a
scope and read by whoever falls inside it — and they are deliberately not here.
Levels are cheap to add (a column and a filter term) and expensive to carry: it
is the rules they need, not the columns, that make the design. They can arrive
with a consumer that keeps them honest.

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

The obvious alternative is to admit a row whose environment is unset, so that a
project value is readable from every environment of that project. It is defensible, and
it may yet be what the "set it once" case needs (§10) — but it is not free. A read
that inherits returns several rows per name, which forces a rule for choosing
between them, and that rule then has to be applied identically by every caller
that reads a variable. Two callers that disagree about it disagree about what a
name holds, silently and in only some of the cases. Equality avoids the whole
class: the owner is an address, and a name at an address is one value.

### 5. Resolution: there is nothing to resolve

A read admits one owner and the primary key makes a name unique within it, so a
name yields at most one row. Callers key the result by name and are done.

This is a consequence of §4 rather than a rule of its own, and it is the point of
§4. Inheritance would need a ranking here — owners ordered by specificity, so
that the narrowest one wins — and that ranking would be a second thing every
reader has to get right.

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
- **Both owner columns carry a foreign key**, the environment through a
  generated column. See the section on the environment level below: the empty
  string is what stops the constraint sitting on `environment_name` directly,
  and `NULLIF` is what gets around it without giving the address up.
- **The primary key, `(name, project_id, environment_name)`, is the uniqueness
  rule.** It is what stops two variables existing at one name and owner, which a
  read would return with no rule for choosing between them. It is also the
  upsert conflict target: writing the same name and owner twice replaces the
  value in place.
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

Storage reads return the ciphertext; nothing decrypts on the way out of the
table.

#### Consuming a secret

There are two ways to get a value, and for a secret they are not equivalent.

- **Fetch by name** (`GetDecryptedVariables`) reads the names a caller asks for
  and decrypts those among them that are secret. **This is the default for a
  secret.** Nothing the caller did not name is decrypted, and the plaintext
  reaches only the code that asked for it.
- **Whole-document substitution** (`ReplaceVariables`) resolves every
  placeholder in a document at once, secrets included. It is for a document
  whose values are all wanted together.

Neither is cheaper. Both are one query for the names plus one key lookup per
distinct key, since key lookups are memoized either way. What differs is what
ends up decrypted, and how far it then travels. An IdP connection makes it
concrete: `client_id` is needed at `authorize`, `client_id` and `client_secret`
at `callback`. Substituting the whole connection at `authorize` decrypts a
credential that step never uses, and hands it to code with no reason to hold it.

That is the standing cost of substituting a secret, and §10 records that it is
unpaid: a resolved document carries decrypted values with nothing marking which
of them were secret, so a caller cannot redact them from a log or a deploy diff.
Fetching by name does not have that problem -- a decrypted variable still
reports `is_secret`, so the caller knows which values to keep out of its own
output. A caller that can name what it needs should.

Substitution still refuses a document whose secret references do not all take
the whole-value form of §2 -- the check runs before any decryption, so such a
document is refused with nothing decrypted.

The management API is the third reader, and it returns neither ciphertext nor
plaintext: a secret reads back as `{"secret": true}`, saying that a value is
held and not what it is. That is not a further rule so much as a refusal to pick
one while §10 is open -- ciphertext is useless to a caller and plaintext would
settle the question by accident.

### 8. Bounded expansion

Three limits keep one small document from rendering an enormous response, and
one in-memory document from recursing forever:

| Limit            | Value              | Why                                                                                      |
|------------------|--------------------|------------------------------------------------------------------------------------------|
| Value size       | 16 KiB per string  | a variable is a config value, not a payload                                              |
| Expansion budget | 1 MiB per document | nothing caps how many places reference one name                                          |
| Document depth   | 20                 | a document built in memory can contain itself; one that arrived as JSON is far shallower |

### 9. Runtime integration: variables are read per use case

Three rules, each a consequence of something above.

**Never on write.** A stored document keeps its references verbatim; nothing
resolves on the way in. A value resolved at write time would be frozen into an
immutable revision, where it cannot be scrubbed and would come back on a
rollback — and since one revision is promoted between environments unchanged
(ADR 035), it would be the wrong value everywhere except where it was written.
§7 is the secret-flavoured half of the same rule: the plaintext never reaches
the row.

**On read, per use case.** Resolution belongs to the code about to use the
value, not to a layer between storage and the domain. A use case knows which
names it needs and when; nothing above it does. So there is no request-scoped
preload and no resolve-everything step on a resource read — either would have to
guess, and guessing means fetching names the request never uses and decrypting
secrets it never touches, which is what §7 exists to avoid.

A domain object therefore carries references, not resolved values. The object
written and the object read back are the same shape, a revision hash over it is
stable, and a document that reaches a log or a diff carries `${{ NAME }}` rather
than a value.

**Whichever path the use case fits.** `GetVariables` / `GetDecryptedVariables`
for one that knows its names — the default, and the only way to reach a secret
(§7). `ReplaceVariables` for one that genuinely wants a whole document resolved
at once.

For the first consumer that is concrete: an IdP connection is stored and read
back holding `"client_id": "${{ GITHUB_CLIENT_ID }}"`. The `authorize` step
reads `GITHUB_CLIENT_ID`; the `callback` step reads `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`. Neither resolves the connection document.

**What this costs.** A use case that forgets to resolve gets the literal
placeholder rather than an error, because §2 leaves an unresolved reference
standing: a `client_id` of `${{ GITHUB_CLIENT_ID }}` reaches the provider and
fails there. That is the price of making resolution explicit, and the deploy-time
validation left open in §10 is where it should be caught before a user is.

There is no per-request cache. Two use cases reading one name in one request are
two queries. Stated so nobody assumes memoization; adding it later changes this
section and not the storage contract.

### 10. What this ADR does not decide

The Scope section above lists these with the trigger for each; what follows is
the reasoning behind them.

- **Fine-grained permissions.** Those endpoints sit behind the same
  project-scoped check as every other management resource, gated on
  `variable.read` / `variable.write`. Reading a secret must eventually be a
  different permission from reading a variable, and the resource has to be
  registered with the permission catalog (ADRs 032-033) for that.
- **Reading a secret back.** The API answers a secret as `{"secret": true}` and
  never with a value, which keeps this open rather than settling it. Whether
  secrets become write-only outright (the GitHub model, two mechanisms rather
  than one) or gain a redaction contract is undecided.
- **Marking secrets in a resolved document.** A document resolved by
  `ReplaceVariables` carries decrypted values with nothing saying which of them
  were secret, so a caller cannot redact them from a log or a deploy diff. §7
  answers this for the caller that can name what it needs -- a fetched secret
  stays marked -- and leaves it open for the caller that resolves a whole
  document. Whether substitution grows a marking contract, or refuses secrets
  outright and forces the fetch, is undecided.
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

## The environment level is a name, and the name is a foreign key

Environments landed as a resource while this was being written (#532): a project
holds environments of `(project_id, id, name)`, the name is unique per project,
addresses the resource on the wire (`GET /environments/{name}`), and is validated
as a lowercase DNS-style label of at most 63 characters.

A variable scopes to that **name** rather than to the environment id, which
matches how an environment is addressed everywhere else, keeps a variable
readable by a request that knows only which environment it is serving, and keeps
the owner tuple a tuple of strings.

The name is **enforced by the database**, against the same
`(project_id, name)` the wire addresses.

### The empty string is the obstacle, and `NULLIF` is the way past it

A foreign key cannot sit on `environment_name` directly. `""` is the project
level (§3, §6), an address of its own held by a real row, and no environment
answers to that name, so the constraint would reject every project-level
variable. Giving the column up to `NULL` instead would cost the primary key,
which cannot span a nullable column, and §6 is the reason that key is what it is.

So the reference sits on a generated column beside it:

```sql
environment_ref TEXT GENERATED ALWAYS AS (NULLIF(environment_name, '')) STORED
FOREIGN KEY (project_id, environment_ref) REFERENCES environments (project_id, name)
```

`NULLIF` maps exactly one address, the project level, to `NULL`, and a
composite foreign key is not checked when any of its columns is `NULL`
(`MATCH SIMPLE`, and the same in all three dialects). The two cases fall out:

| Owner | `environment_ref` | Constraint |
|---|---|---|
| `(project, "")` | `NULL` | not checked: the project level needs no environment |
| `(project, "prod")` | `"prod"` | checked: `prod` must exist on that project |

The column is derived, never written, and not bound in `variable.Schema`. The
row shape, the primary key, the upsert conflict target and every statement still
address `environment_name`; nothing above the DDL changed.

Two things follow:

- **A name nothing answers to is refused on write.** Previously a typo wrote
  into an owner nothing would ever read from, and with no inheritance to fall
  back on (§4) what the request meant to reach read as empty rather than as the
  project's value, a wrong answer with nothing to see. The write now fails, and
  the service reports it as `env.not_found` rather than an internal error.
- **Deleting an environment takes its variables with it**, the way deleting a
  project does. Project-level variables are untouched: their `environment_ref`
  is `NULL`, so no cascade reaches them.

### No `ON UPDATE CASCADE`, deliberately

Spanner has no `ON UPDATE` clause on a foreign key at all (it is a parse error,
not a no-op), so cascading a rename in Postgres and SQLite would put the three
dialects out of parity on a domain-visible behavior, which is exactly what the
storage contract tests exist to prevent.

Nothing renames an environment today: the API is create, get and list. Until
something does, the constraint refuses a rename while variables point at the old
name, in every dialect. That is the third of the three options this ADR
previously left open (cascade the name, forbid the rename, or orphan the rows)
and it is the one that decides the least: it cannot silently strand a variable,
and whichever answer the environment lifecycle eventually wants is still
available.

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
rejected: it is the honest answer to read-back and deploy diffs (§10), but it
doubles the surface before there is an API to double, and the encryption flag
already gives the two different storage behavior.

**Per-environment values inside the release.** Impossible under ADR 035: a
release is promoted between environments unchanged, so anything inside it is by
definition the same everywhere.

**An owner hierarchy** (an environment inheriting the project's variables, the
narrowest owner winning). Deferred rather than rejected, for the reason in §4:
it makes a read return several rows per name, which needs a rule for choosing
between them, which every reader then has to apply the same way. It is the
better answer for a value that should hold everywhere, and §10 keeps that case
open; it is not something to carry before there is a case for it.

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
- An environment-scoped variable cannot name an environment that does not exist,
  and does not outlive the one it names. The cost is that an environment cannot
  be renamed while variables point at it, which nothing can do today.
- A missing value ships the literal placeholder until deployment validation
  exists (§10). This is the sharpest edge in the design as it stands.
- Variables are outside releases, so a deployment is no longer fully described
  by the release it pins: two environments running one release can behave
  differently. That is the point, and it is also a new thing for an audit trail
  to cover.
