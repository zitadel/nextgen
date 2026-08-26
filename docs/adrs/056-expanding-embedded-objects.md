# ADR 056: Expanding Embedded Objects

> **Status:** Proposed
> **Date:** 2026-08-26
> **Context:** List responses that would otherwise force a request per item
> **Builds on:** [ADR 027](027-cursor-based-pagination.md), [ADR 031](031-openapi-querying.md)

## Decision

A list endpoint may let the caller embed a related collection, opt-in, through
an `expand` field on the query body:

```json
{ "limit": 20, "expand": ["teams"] }
```

Nine rules govern every such field.

1. **Opt-in.** No `expand`, no embedded children. The default response shape
   never changes.
2. **Closed enum, per endpoint.** An unrecognised value is
   `400 req.invalid`, never a silent ignore.
3. **Absent is not empty.** The property is omitted entirely when not
   requested, and `[]` when requested against an item with no children. The
   caller can always tell "did not ask" from "there are none".
4. **The embedded item is the sub-resource item.** Both `$ref` one schema, so
   the two representations cannot drift.
5. **A hard cap, and a truncation flag beside it.** An embedded collection is
   not paginated, so it is bounded by a fixed server-side cap and the response
   states when it was cut.
6. **The paginated sub-resource remains the authority.** Expansion is a
   round-trip optimisation for the common case. Anything past the cap, or
   needing its own ordering or filtering, uses
   `GET /<resource>/{id}/<children>`, which keeps the ADR 027 cursor contract.
7. **Hydrate, never join.** The server runs the list query, then loads children
   in one batched query keyed on the page's ids.
8. **Expansion never widens authorization.** A caller who may not read the
   child resource may not read it embedded either; the endpoint gates the
   expansion separately and answers `403` rather than silently dropping the
   property.
9. **Expansion never affects ordering or pagination.** A page token is valid
   with or without `expand`, and means the same thing either way.

## Context

Rendering a list of parents with a few children each is otherwise N+1 requests,
which is the problem `include` (JSON:API), `$expand` (OData) and `expand[]`
(Stripe) all solve. We take the in-place, inline form: it needs no
client-side join, and it costs one enum plus one optional property per
endpoint.

Rules 5–7 are where the cost actually lives.

Joining the children into the list query breaks cursor pagination outright.
`LIMIT` counts joined rows rather than parents, so one parent with many
children swallows the page; and the keyset cursor is marshalled from the last
row's sort values, which row fan-out makes meaningless. Both failures are
silent, and both surface as pages that skip or repeat. A batched second query
keyed on the ids already returned leaves `ORDER BY` and the cursor untouched —
hence rules 7 and 9.

An uncapped embedded collection makes page weight unbounded: a single parent
with thousands of children can dominate a response whose `limit` promised
twenty items. The cap keeps the page predictable, and rule 6 is what makes the
cap acceptable — there is always a paginated endpoint that gives the full set.

Rule 8 exists because expansion crosses a resource boundary that the parent's
own permission does not cover. Reading users is not reading team rosters.

## Consequences

- Each expandable relation costs a batched query per page, not per item.
- A caller wanting the complete child set makes two calls: the list, then the
  sub-resource for the parents that report truncation.
- Every expandable relation requires a paginated sub-resource endpoint first.
  That is a deliberate ordering constraint: expansion is added to an existing
  child endpoint, never in place of building one.
- The child's permission appears in the parent endpoint's declared scopes,
  so the security block no longer reads as the parent resource alone.

## Open questions

- **Sparse fieldsets.** Selecting a subset of the embedded object's properties
  (JSON:API's `fields[]`, OData's `$select`) is not specified. Embedded items
  are whole objects.
- **Nested expansion.** `expand: ["teams.projects"]` is not specified, and the
  cap composes badly with depth. One level until there is a concrete need.
- **Where the cap is declared.** Whether it is per relation, per endpoint, or a
  single platform-wide number is unresolved; the first implementation picks a
  per-relation constant.
