# ADR 062: Resource Revisions: Fixed Id and Revision Id

> **Status:** Proposed  
> **Date:** 2026-09-16  
> **Context:** Review of the connection API (#1217); [ADR 035](035-configuration-environments.md#releases) Releases  
> **Builds on:** [ADR 047](047-dialect-id-generation.md) (dialect-minted prefixed ids)
>
> **Amends** [ADR 035](035-configuration-environments.md): every revisioned
> resource carries a fixed `id` and a `revision_id`, and a release pointer
> pins `revision_id`. Amends [ADR 047 §2 and §5](047-dialect-id-generation.md#5-not-resource-pk-generation):
> a schema's resource id is always dialect-minted; a declared `$id` stays a
> document property.

## Context

ADR 035 requires every configurable resource to be revisioned: a content change
produces a new immutable revision, and previous revisions stay addressable. It
names schemas as the example and leaves the shape of a revision to each kind.

Three kinds revise today, and a fourth is defined in #1217. Each does it
differently:

| Kind             | What `id` names        | Correlated by                  | Fixed id |
|------------------|------------------------|--------------------------------|----------|
| schema           | one revision           | `objectType`                   | none     |
| flow definition  | one revision           | `name`                         | none     |
| branding         | one revision           | the project (handle `default`) | none     |
| idp connection   | the connection         | `slug`                         | `id`     |

- A schema's `id` is a server-minted `sch_*` value, or the `$id` URI the
  document declared at creation.
- A flow definition gets a new `flowdef_*` id on every write.
- Branding publishes a new row per edit, with its own id.
- A connection, as defined in #1217, keeps one `id` for life and adds a
  `revision_id` per revision, because identity links reference the connection
  and must keep resolving after a revise.

This ADR uses three words. A kind is schema, flow definition, branding or
connection. A resource is one of a kind, such as the `Consumer` schema or the
`google` connection. A revision is one immutable version of a resource.

So `id` has two meanings in one API. For three kinds it names a revision, for
one kind it names the resource. A release pointer records the revision it
pins under `revision_id`, and for schemas, flow definitions and branding that
value is the resource `id`. The field name alone does not say whether an `id`
identifies a resource or one revision of it.

There are two ways to make `id` mean one thing. Either connections change to
match the three older kinds, so `id` names a revision and the fixed id becomes
a `connection_id` that only connections carry. Or the three older kinds change
to match connections, so every kind has a fixed `id` and a `revision_id`.

This ADR chooses the second. Every kind then has the same two fields with the
same meaning, which keeps the API docs and the clients simple.

## Decision

### 1. Two ids on every revisioned resource

Every revisioned resource carries two ids:

- `id` is allocated once, when the resource is created, and is shared by
  every revision of it.
- `revision_id` is allocated per revision.

Both ids, when newly allocated, are prefix plus opaque id per ADR 047. Each
kind registers two prefixes, one for the resource and one for the revision. A
connection, for example, carries `idp_01KWH3B72K7M7F0N9WD3P2E4YM` as `id` and
`idprev_01KWH3B72K7M7F0N9WD3P2E4YN` as `revision_id`.

### 2. A revision is immutable

A write appends a revision. A revision is never edited in place, and previous
revisions stay addressable, as ADR 035 requires. Deleting a resource is per
kind and outside this ADR.

### 3. Handles stay per kind

Each kind keeps its handle:

- `objectType` for schemas
- `name` for flow definitions
- `slug` for connections
- the constant `default` for branding, which has no naming field

A handle is unique within a project for its kind and fixed for the life of
the resource. It resolves through the kind's list filter.

### 4. Reads

Every resource kind has four reads:

- The list or query returns each resource once, at its newest revision. It
  carries no history, so it takes no `revisions` parameter.
- `GET /<kind>/{id}` returns the resource at its newest revision.
- `GET /<kind>/{id}/revisions` returns the revisions of one resource.
- `GET /<kind>/revisions/{revision_id}` returns one revision. A release
  pointer holds a `revision_id` and no resource id, so this read takes the
  `revision_id` alone. A prefixed id cannot collide with the literal
  `revisions`.

`GET /<kind>/revisions/{revision_id}` is the read a release depends on. When
a release is created, the release service reads each pinned revision through
it to check that the revision exists, and ADR 035 tells consumers of a release
to fetch its content the same way. A kind therefore gets both revision routes
before it can be pinned by a release.

Today `GET /schemas` has a `revisions=all|latest` mode (#957). It is removed
once the revision routes for schemas exist.

### 5. References

A resource can be referenced in three ways:

- **By handle**, inside a release. Resources in a release reference each other
  by handle, and a handle means the revision the release pins for it.
  Unchanged from ADR 035.
- **By `id`**, when the reference must outlive revisions. An identity link
  references a connection's `id`.
- **By `revision_id`**, when the reference must keep pointing at one exact
  revision. Releases, auth attempts and user records pin a `revision_id`.

### 6. The release pointer

A release pointer stays `{kind, handle, revision_id}`. Its `revision_id` is
the revision's own `revision_id`, no longer the resource `id` that stood in
for it. The ADR 035 example reads, for the kinds that exist:

| Kind             | Handle                       | `revision_id`  |
|------------------|------------------------------|----------------|
| schema           | `objectType` = `human-user`  | the revision   |
| flow_definition  | `name` = `default-login`     | the revision   |
| branding         | `default`                    | the revision   |
| idp              | `slug` = `google`            | the revision   |

Prefix tokens are domain constants registered per ADR 047.

## Migration

Connections already have the two ids. The three older kinds should adopt this
as well. Each migration is its own ticket. Each adds the two revision routes
for its kind and switches the release service's pointer validation from
get-by-id to `GET /<kind>/revisions/{revision_id}`:

- **Flow definitions.** `id` becomes fixed per `name` and each write allocates
  a `revision_id`. The list filtered by `name` returns the newest revision of
  one flow, and `GET /flow_definitions/{id}/revisions` returns its history.
- **Schemas.** All revisions of one `objectType` share a fixed `id`, and each
  write allocates a `revision_id`. A document's `$id` URI stays a property of
  the document and is no longer used as the resource id. Rows that are
  identified by a URI today keep that URI as their `revision_id`, because
  releases already pin it. The ticket also updates the users and flow steps
  that reference a schema by its id. A schema stored without an `objectType`
  has nothing to group its revisions by; the ticket decides whether such a
  document is rejected or kept as a resource with one revision. `GET /schemas`
  drops its `revisions` mode and returns each schema once. The CLI
  `schemas list` command shows the history of one `objectType` and relies on
  the `all` default today; the ticket moves it to
  `GET /schemas/{id}/revisions`, with the id resolved through the list
  filtered by `objectType`.
- **Branding.** `id` becomes fixed per project and each publish allocates a
  `revision_id`.

The existing prefix of each kind names the resource, as `idp_` does for
connections, and each migration registers a revision prefix. If existing rows
are carried over, they keep their current id as their `revision_id`. A value
that a release, a user record or a flow step holds is still found through
`GET /<kind>/revisions/{revision_id}`. Those holders look the value up with
get-by-id today, and the migration ticket changes their lookups to that
route. Before the migration a
client that stored `sch_01A` reads it with `GET /schemas/sch_01A`. After it,
`sch_01A` is a `revision_id`, and get-by-id matches the `id` column only, so
that call returns not found. The client reads the row through
`GET /schemas/revisions/sch_01A` instead.

## Consequences

- `id` means the same thing for every kind, and the release layer pins one
  field name everywhere.
- Every revisioned row carries two ids, and the prefix registry gains one
  entry per kind.
- For schemas, flow definitions and branding, get-by-id is the per-revision
  read today, because their `id` names a revision. Once `id` is fixed, each
  migration ticket adds the two revision routes for its kind. Connections
  have neither route; a follow-up to #1217 adds them.
- If existing rows are carried over, ids of schemas, flow definitions and
  branding that a client stored before the migration stop working with
  get-by-id, as described under Migration. The console and the CLI sync read
  such ids with get-by-id today, and each migration ticket changes those calls
  to `GET /<kind>/revisions/{revision_id}`. Other clients make the same change
  themselves.
- The ADR 035 example table and its pointer prose are read through this ADR.
  ADR 035 itself changes only by the amendment notes that point here.

## Open questions

- **Existing rows.** Whether the migrations carry existing schemas, flow
  definitions and branding at all is open. The project is in alpha, and #957
  and #932 edited migrations in place on that basis. If they are dropped,
  nothing below applies. If they are carried, each row's id is copied into
  `revision_id`, and the resource needs a fixed `id`, one new value shared by
  all of its rows. Carried revision ids then keep the resource prefix, so a
  `sch_` value no longer says whether it is a resource id or a revision id,
  and the third option below makes the oldest row's id equal its own
  `revision_id`. Re-prefixing carried revision ids avoids that but rewrites
  what releases, users and flow steps hold. Migrations are SQL files, and ADR
  047 allows minting only through the dialect generator in Go, so the
  migration cannot create the fixed `id`. Three options:
  - mint it in SQL with the dialect's UUID function, which needs an ADR 047
    exception for backfills and gives those ids a UUID body where other ids
    of the kind have a ULID body on Postgres and SQLite; ids are opaque to
    clients, so this is a consistency cost, not a breakage
  - run a Go step after the SQL migration that allocates it through the
    generator
  - reuse the oldest revision's id as the fixed `id`, so no new value is
    needed

  The first migration ticket decides.
