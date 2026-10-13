# ADR 069: Variables per Kind, Frozen per Deployment

> **Status:** Proposed
> **Date:** 2026-10-12
> **Context:** [#1567](https://github.com/zitadel/nextgen/issues/1567), the
> storage half of [#1566](https://github.com/zitadel/nextgen/issues/1566)
> (variables owned by the project, frozen per deployment). The decisions were
> posted on #1566 and carried to the variables contract
> ([#1587](https://github.com/zitadel/nextgen/issues/1587)), the deployments
> contract ([#1584](https://github.com/zitadel/nextgen/issues/1584)) and the
> CLI ([#1617](https://github.com/zitadel/nextgen/issues/1617)).
>
> **Builds on:** [ADR 062](062-per-environment-variables-and-secrets.md)
> (variables and secrets, `${{ NAME }}`; its Scope, Storage and Deployment
> validation sections state the model chosen here and were updated in place,
> since that ADR is still proposed),
> [ADR 029](029-cryptography-secrets-and-key-lifecycle.md) (envelope
> encryption under per-project keys),
> [ADR 068](068-project-is-the-data-boundary.md) (no environment entity; a
> deployment targets the project's primary origins or a preview URL)
>
> **Deviates from** [ADR 047](047-dialect-id-generation.md) §Prefix registry:
> neither `variable_sets` nor `deployment_variable_sets` has a minted PK; a
> set is keyed by its content hash and a link by its deployment (§4).

## Context

ADR 062 first scoped a variable to a project or to one of its environments and
left deploy-time validation open; its body now states the model this ADR
chose. ADR 068 removed the environment, and with it the only thing that told a
preview's values from production's. One rule of that
scope survives: a preview URL is reachable by anyone who can guess it, so it
must never run with a production secret.

A deployment also has to keep the values it was created with. The deployment
history is append-only and a rollback is another deployment of an earlier
release: if it restored the release and not the values, a release that needed
last month's client secret would run with this month's. A flow that pins a
deployment id pins the resources and the values with one pointer only if the
values cannot move underneath it. And editing a variable during a sign-in must
change nothing that sign-in can see: a change reaches the next deployment and
nothing already deployed.

#1567 left the shape open, a copy of the values per deployment or a reference
into versioned variables. This ADR records the choice.

## Decision

### 1. The store is rows per kind

A variable belongs to the project and says which kind of target it applies to,
`primary` or `preview`, the two kinds of target ADR 068 leaves a deployment.
`variables` is keyed `(project_id, name, kind)`. A value that applies to both
kinds is two rows, and every write, read and delete names its kind. The kind
is stored as its name under a CHECK rather than as a number, so a reordering
of the Go constants cannot reinterpret rows already written.

### 2. No fallback

A deploy freezes only the rows of its kind. A name with no row for that kind
is left out: a preview never gets the primary value, and a primary deploy never
sees a preview one. A deploy whose release references a name its frozen set
lacks is refused, primary and preview alike, rather than deployed with a
placeholder left unresolved; the service enforces this (#1566). What a write
that names no kind stores is the service's decision (#1566); the store holds
what it is told.

### 3. Frozen values are content-addressed sets

`variable_sets` holds one immutable JSON document per distinct set of values
in a project, keyed `(project_id, content_hash)`:

| Column         | Holds                                                                                                         |
|----------------|---------------------------------------------------------------------------------------------------------------|
| `project_id`   | foreign key to `projects`, `ON DELETE CASCADE`                                                                |
| `content_hash` | 64 hex characters, the SHA-256 below; named as `releases.content_hash` is, and HASH is reserved in GoogleSQL |
| `entries`      | a JSON object `{"NAME": {"value": <json>, "secret": true}}`, one key per name, `secret` omitted when false     |
| `created_at`   | when the set was first stored; never read back                                                                |

Identical values are one row however many deployments use them: a deploy that
changed no value writes no set, and a rollback reuses the set it rolls back
to. A set is *resolved*: it holds one kind's values, and an entry carries no
kind. A project with no variables freezes the empty set, stored and linked
like any other, so a deployment always has its values.

The hash is computed in Go, never in SQL: Spanner's JSON type does not
round-trip bytes, so the column can never be the preimage. The preimage is the
version tag `vset-v1\x00`, then, for each entry in name order, three fields
each written as `<length>:<bytes>`: the name, `0` or `1` for the secret flag,
and the canonical value. The canonical value of a secret is its JWE
ciphertext verbatim. The canonical value of a plain value is the JSON of its
scalar, with every number first widened to `float64`, which is what every
dialect decodes a JSON number into, so a set hashes the same frozen from a
fresh write as read back from a column. A duplicate name is refused, not
ranked. The length-prefixed form is the release content hash's, for the same
reason: a value can hold any byte, so no separator is unambiguous.

Sets are per project and never shared across projects: an equal hash in two
projects would reveal that two tenants hold the same values.

### 4. The deployment link

`deployment_variable_sets` records which set a deployment runs with, one row
per deployment, keyed `(project_id, deployment_id)` and written in the
deployment's transaction:

| Column          | Holds                                                                                                  |
|-----------------|--------------------------------------------------------------------------------------------------------|
| `project_id`    | foreign key to `projects`, `ON DELETE CASCADE`                                                         |
| `deployment_id` | with `project_id`, foreign key to `deployments (project_id, id)`, `ON DELETE CASCADE`                  |
| `kind`          | which rows were frozen, since the set itself does not say                                              |
| `set_hash`      | with `project_id`, foreign key to `variable_sets (project_id, content_hash)`, `ON DELETE NO ACTION`; indexed   |

The set key is `NO ACTION`, so a set a deployment uses can never be deleted.
The direct project key exists beside the deployment key because Postgres runs
cascades one level at a time: deleting a project removes the sets at the first
level, but through the deployment key alone the link rows would go only at the
third (projects, then releases, then deployments), and the `NO ACTION` check
would find them still there and abort the delete. `sessions` has the same
shape.

The freeze is one statement that, inside one transaction, reads the variables
of the kind, builds the set, inserts it only when its hash is new to the
project (an insert that ignores the key conflict and nothing else), inserts
the link and returns the set. A second freeze of the same deployment is a
`database.UniqueError`, an unknown deployment a `database.ForeignKeyError`,
and reading a deployment that was never frozen a `database.NoRowFoundError`.
No new domain error is added, because each one generates an API error schema.
Neither table has a minted id, as ADR 062 already deviates from
[ADR 047](047-dialect-id-generation.md): a set is addressed by its hash and a
link by its deployment.

SQLite and Spanner hold the same three tables with their own JSON column
types, and the shared statement suite
([ADR 041](041-storage-statement-contract-tests.md)) asserts the behavior
above on all three dialects.

### 5. Secrets

- The freeze copies a secret's ciphertext byte for byte. It never decrypts and
  re-encrypts, so a frozen set exposes nothing the store did not, and a frozen
  secret still decrypts by the key id in its own JWE header (ADR 062).
- The hash covers the ciphertext, never the plaintext. A hash of a low-entropy
  secret could be reversed with a dictionary.
- JWE uses a random IV, so a ciphertext identifies one write. A later
  revocation deny-list keyed by `sha256(ciphertext)`, or a value table, can
  then cover existing sets without rewriting them.

### 6. Implemented elsewhere

Decided here or on the issues, implemented outside #1567:

- the refusal of a deploy whose release references a name missing from its
  frozen set (§2): the service finds the names with
  `domain.ScanDocumentForVariables` (#1566), and its error surfaces on
  `POST /deployments` (#1584)
- the default kind on a write that names none (a plain value to both kinds, a
  secret to primary only) and variable audit events (#1566)
- the API and CLI shapes (#1587, #1617)
- rollback attaching an existing set (#1566 or #1584 adds a statement for it)

## Consequences

- A deploy writes zero or one set rows, and one link row.
- The deploy idempotency check compares `(release_id, set_hash)`: the same
  release with a changed variable is a new deployment, not "nothing changed"
  (#1584).
- A rollback reuses the old set.
- A project key cannot be retired while a frozen set still holds a ciphertext
  under it. Finding those means reading the JWE headers in the sets; nothing
  indexes the key id.
- A set no deployment references can be collected, but no garbage collection
  exists yet.
- A set is one cell, and a Spanner cell holds at most 10 MiB; Postgres JSONB
  and SQLite TEXT allow far more, so Spanner is the binding limit. The worst
  case per entry, measured through the code path a secret takes: a name is at
  most 255 bytes (`domain.MaxVariableNameLength`) and a string value at most
  16 KiB (`domain.MaxVariableStringLength`); a secret holds the compact JWE
  (A256GCMKW key wrap, A256GCM content) of the JSON-encoded value, whose
  base64url ciphertext is 4/3 of that JSON plus 276 bytes of protected header
  with a 44-byte key id, wrapped key, IV, tag and separators; the entry's own
  JSON adds about 30 bytes. A value that JSON-encodes without escapes gives a
  22,124-byte JWE and a 22,411-byte entry, 467 per cell. `json.Marshal`
  escapes `<`, `>`, `&` and control characters as six bytes each, so a value
  made of them encodes to 98,306 bytes, encrypts to a 131,351-byte JWE and
  freezes as a 131,638-byte entry: 79 such entries fill the cell. A
  per-project cap on variables is therefore needed so a freeze can never
  exceed the cell, 79 names if the cap is a count or a budget on the encoded
  size; enforcing it is the service's job on write (#1566), and this change
  adds no enforcement.
- The rework of deployments over targets
  ([#1572](https://github.com/zitadel/nextgen/issues/1572)) must keep
  `deployments (project_id, id)` as the target of the link's foreign key.
- The migration drops the existing variables on every dialect: the product is
  in alpha, and SQLite and Spanner cannot change a primary key in place
  anyway. Values entered before it are entered again.

## Alternatives considered

- **Copy rows per deployment**, as the spike
  ([PR #1427](https://github.com/zitadel/nextgen/pull/1427)) sketched: N rows
  per deploy and per rollback.
- **Versioned variables with pointer rows per deployment:** still N rows per
  deploy, plus versioning the variable itself.
- **Versioned variables with a per-project watermark:** zero rows per deploy,
  but a deployment's values stay unchanged only as long as no code deletes or
  edits history, and the history can fork but not merge.
- **A JSON document on the deployment row:** no deduplication, and welded to
  the deployment.
- **Values behind pointers** (a value table): deferred until per-variable
  history is required; possible later without rewriting sets.
- **A git-like commit and ref layer:** not needed.
- **A Go VCS library:** none is maintained and fits Postgres, SQLite and
  Spanner; go-git merges fast-forward only, Dolt is too heavy, lakeFS is BUSL.
