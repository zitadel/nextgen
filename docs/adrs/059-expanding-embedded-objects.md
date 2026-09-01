# ADR 059: Expanding Embedded Objects

> **Status:** Proposed
> **Date:** 2026-08-26
> **Context:** List responses that would otherwise force a request per item
> **Builds on:** [ADR 027](027-cursor-based-pagination.md), [ADR 031](031-openapi-querying.md)

## Decision

A list endpoint may let the caller embed a related object, opt-in, through an
`expand` field on the query body:

```json
{ "limit": 20, "expand": ["teams", "lifecycle_owner_team"] }
```

A relation is either **to-many** (a collection, like a user's team
memberships) or **to-one** (a single object, like the team that owns a user's
lifecycle). Nine rules govern every such field; rules 5 and 6 apply to
to-many relations only, because a to-one has nothing to bound.

1. **Opt-in.** No `expand`, no embedded object. The default response shape
   never changes.
2. **Closed enum, per endpoint.** An unrecognised value is `400 req.invalid`,
   never a silent ignore.
3. **Absent is not empty.** The property is omitted entirely when not
   requested. When it was requested and the item has nothing, a to-many
   answers `[]` and a to-one answers `null`. The caller can always tell "did
   not ask" from "there is none".
4. **The embedded object is the sub-resource's own representation.** Both
   `$ref` one schema, so the two cannot drift. For a to-many that is the item
   of `GET /<resource>/{id}/<children>`; for a to-one it is the body of
   `GET /<children>/{child_id}`.
5. **A hard cap, and a truncation flag beside it.** *(to-many only.)* An
   embedded collection is not paginated, so it is bounded by a fixed
   server-side cap and the response states when it was cut.
6. **The paginated sub-resource remains the authority.** *(to-many only.)*
   Expansion is a round-trip optimisation for the common case. Anything past
   the cap, or needing its own ordering or filtering, uses
   `GET /<resource>/{id}/<children>`, which keeps the ADR 027 cursor contract.
7. **Hydrate, never join.** The server runs the list query, then loads the
   related objects in one batched query keyed on the page's ids — the parents'
   ids for a to-many, the distinct foreign keys the page carries for a to-one.
8. **Expansion never widens authorization.** A caller who may not read the
   related resource may not read it embedded either; the endpoint gates each
   expansion separately, under that resource's own permission, and answers
   `403` rather than silently dropping the property. Two relations on one
   endpoint are two gates, not one. The gate is on the whole request only
   while the permission is; when it becomes per target or per row, a page may
   mix rows the caller may resolve with rows it may not, and the response
   needs a third answer for the latter — `403` for the request is wrong when
   most of the page is readable, and the empty answer is usually already
   spoken for. This is the direction, not a rule yet; #420 settles it.
   Embedding a whole object is what makes this the expansion's problem — a
   reference field carrying only the target's id and display strings (ADR 058)
   rides the referencing resource's own permission and needs no gate of its
   own.
9. **Expansion never affects ordering or pagination.** A page token is valid
   with or without `expand`, and means the same thing either way.

## Context

Rendering a list of parents with a few children each is otherwise N+1 requests,
which is the problem `include` (JSON:API), `$expand` (OData) and `expand[]`
(Stripe) all solve. We take the in-place, inline form: it needs no client-side
join, and it costs one enum plus one optional property per endpoint.

Rules 5–7 are where the cost actually lives.

Joining the children into the list query breaks cursor pagination outright.
`LIMIT` counts joined rows rather than parents, so one parent with many
children swallows the page; and the keyset cursor is marshalled from the last
row's sort values, which row fan-out makes meaningless. Both failures are
silent, and both surface as pages that skip or repeat rows. A batched second
query keyed on the ids already returned leaves `ORDER BY` and the cursor
untouched — hence rules 7 and 9.

An uncapped embedded collection makes page weight unbounded: a single parent
with thousands of children can dominate a response whose `limit` promised
twenty items. The cap keeps the page predictable, and rule 6 is what makes the
cap acceptable — there is always a paginated endpoint that serves the full set.

A to-one relation has neither problem. One parent resolves to at most one
object, so page weight stays proportional to `limit` on its own, and there is
nothing to truncate or page through. Rules 5 and 6 are therefore scoped to
to-many rather than softened for everyone: the cap is not optional where it
applies.

Rule 8 exists because expansion crosses a resource boundary that the parent's
own permission does not cover. Reading users is not reading team memberships,
and it is not reading teams either — which are two different permissions, so
one endpoint offering both relations carries two independent gates.

## Consequences

- Each expandable relation costs one batched query per page, not one per item.
- A caller wanting the complete child set makes two calls: the list, then the
  sub-resource for the parents that report truncation. To-one relations are
  complete as embedded.
- Every expandable relation requires a sub-resource endpoint first — paginated
  for a to-many, by-id for a to-one. That is a deliberate ordering constraint:
  expansion is added to an existing endpoint, never in place of building one.
- The related resource's permission appears in the parent endpoint's declared
  scopes, so the security block no longer reads as the parent resource alone.
  An endpoint with several expandable relations accumulates several.

## First use

`POST /users/query` with `expand: ["teams"]` embeds each user's team
memberships, capped at 10 with `teams_truncated`, sharing `UserTeam` with
`GET /users/{user_id}/teams`. The three dialects hydrate it with one batched
second query keyed on the page's user ids.

Rule 8 is satisfied by `team_membership.read`, which gates that expansion, the
`team_id` filter, and the sub-resource alike.

That query reads every current membership of the page's users and applies the
cap in Go. Bounding the read instead — a per-user `ROW_NUMBER` window fetching
cap+1 rows each — is the tighter shape, but the Spanner emulator rejects
analytic functions, and the dialect-parity suite holds all three to the same
behavior. Portability won. The read is bounded by the page's users rather than
by the cap, which is acceptable while pages are small; if a resource appears
where parents routinely hold thousands of children, revisit it per dialect.

The first to-one is `expand: ["lifecycle_owner_team"]` on the same endpoint,
which resolves `metadata.lifecycle_owner_team_id` into
`metadata.lifecycle_owner_team`, sharing the `TeamResponse` body with
`GET /teams/{team_id}`. It hydrates from the page's distinct owner ids, so a
page of self-owned users runs no second query at all, and it is gated by
`team.read` — a different permission from the membership expansion beside it,
which is what rule 8's "two relations, two gates" is about.

It is also where rule 8's per-target question lands first. `null` on that
property means self-owned, so it cannot double as "you may not read this
owner"; the request-wide `team.read` check is the only reason the property is
present on every user of the page today, and #420 is what decides the answer
for a row whose owner the caller may not read. The wire description says as
much, so the pair is not read as exhaustive.

## Open questions

- **Sparse fieldsets.** Selecting a subset of the embedded object's properties
  (JSON:API's `fields[]`, OData's `$select`) is not specified. Embedded items
  are whole objects.
- **Nested expansion.** `expand: ["teams.projects"]` is not specified, and the
  cap composes badly with depth. One level until there is a concrete need.
- **Where the cap is declared.** Whether it is per relation, per endpoint, or a
  single platform-wide number is unresolved; the first implementation uses a
  per-relation constant.
