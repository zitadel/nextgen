# ADR 087: Search

> **Status:** Proposed
> **Date:** 2026-11-10
> **Builds on:** [ADR 031](031-openapi-querying.md) (query endpoints),
> [ADR 047](047-dialect-id-generation.md) (prefixed ids),
> [ADR 058](058-user-identity-designation-and-references.md) (a user's
> identifier and display) and
> [ADR 068](068-project-is-the-data-boundary.md) (the project boundary).
> **Amends:** the Search row of
> [`resource-map.md`](../design/api/resource-map.md#search-bulk-aggregation--mvp-scope),
> which deferred `POST /search` to after the MVP.

## Context

An administrator looks for a thing they can name: a person's email, a team, a
schema, a flow, an identity provider, an id from a log line. Each has its own
query endpoint with its own filter fields ([ADR 031](031-openapi-querying.md)),
so a client that offers one search field sends a request per resource and
learns each resource's rules. The console's ⌘K palette does exactly that, and
finds only what it has taught itself to ask for.

Finding a user by the start of their identifier is `identifier` `starts_with`
on `queryUsers` (`POST /users/query`). This ADR adds the one request that asks
every searched type the same question.

## Decision

### 1. One operation, scoped to a project

`search` (`POST /search`) takes text and answers with the things in one project
that match it. `project_id` names the project as on every project-scoped
operation, and the caller's grants narrow each type as they narrow that type's
own list.

The text travels in the body, not the URL: it is often an email address, and
URLs reach access logs.

### 2. The request names the types it wants

| Field | Meaning |
| --- | --- |
| `query` | The text to find, 1 to 200 characters. Text that is blank once trimmed finds nothing. |
| `types` | Required, at least one. Only these types are searched. |
| `limit_per_type` | How many results each type may contribute: 1 to 20, default 5. |

`types` is required so that a client only ever receives a type it asked for.
A generated client refuses an enum value it does not know, so "leave it out for
everything" would turn each new type into a breaking change.

`limit_per_type` is not `limit`, and there is no `page_token`: search answers
with the best matches. Both names stay free for a ranked, paged search.
Reading every match is the job of the type's query endpoint.

### 3. A result is a reference

Every result has the same shape, whatever its type:

| Field | Meaning |
| --- | --- |
| `type` | One of the result types. |
| `id` | The id the type's own operations take. |
| `project_id` | The project the result belongs to. |
| `title` | What to call it. |
| `subtitle` | A second line that tells two titles apart, when there is one. |

A client that needs the resource reads it by `id`. A uniform shape needs no
`oneOf`, costs one small object per result, and lets a client render a type it
has never drawn.

`results` is ordered best match first, and types may interleave: a client that
wants groups groups by `type`. `incomplete_types` names the types whose results
are not all there, for whatever reason: more matches than the limit, a bounded
read, or text too short for that type.

### 4. Matching and ranking belong to the server

The contract promises that results match the text, and nothing about how. A
client treats them as suggestions; exact filtering is a query endpoint's job.
That leaves room to widen matching and improve ranking without a breaking
change.

What the first version does:

| Type | Matches on | `title` | `subtitle` |
| --- | --- | --- | --- |
| `user` | the start of the designated identifier or of a part of the display name, from three characters | the display, else the identifier, else the id | the identifier, under a display |
| `team` | the name, as a substring | the name | none |

- Text that is an id of a searched type (`user_…`, `team_…`) is looked up as
  that id instead of as text.
- Matching ignores case.
- Each type contributes its best matches among the rows it read: a whole-value
  match, then a prefix, then a substring.
- Users come from the search index
  ([ADR 058](058-user-identity-designation-and-references.md)), which returns
  them best match first, so a user search reads only the users it answers
  with. It matches the start of a value, not a part inside it: an email's
  domain or the second word of a single `name` property finds nobody. Three
  characters is a floor for relevance, not for cost: a shorter text starts too
  many values to tell users apart.

### 5. The first version reads what exists

It adds no table or statement of its own. Each requested type costs one access
check and one read through that type's list, run one after another, so a
caller sees exactly what that type's own list would show them. The user read
is a search of the users list's index, one range per designated property,
whose cost does not grow with the number of users. The team read matches the
name as a substring, which reads every team of the project.

## Consequences

- The console's palette sends one kind of request, and gains a type by naming
  it.
- A user search costs the same in a project of any size. A full identifier
  is the first user found, since a whole value comes before the values it
  starts.
- A person found today by a part inside their email is no longer found by it;
  the start of the email, of the given name or of the family name finds them.
- A project with very many teams answers a team search slowly until the name
  match is indexed as the user match is.

## What this leaves for later

Each is an addition under this contract:

- More types: user schemas, flow definitions and identity providers next, then
  applications once they can be listed.
- Text inside a value: an email's domain, a word after the first of a name.
- The same index for a team's name.
- Search across the projects a person can act on, by leaving out `project_id`
  on a session; `project_id` on every result is there for it.
- A `zitadel search` command.

## Rejected alternatives

- **`GET /search?q=`.** Cacheable, but the text is personal data in a URL.
- **Full resources in results, as a `oneOf` per type.** A wider contract for
  every type added, and most callers only render a row and navigate.
- **`types` optional, defaulting to all.** See §2.
- **An external engine, or an index for substring matches.**
  [ADR 031](031-openapi-querying.md) rules out the engine, and a substring
  index is a different mechanism on each of Postgres, Spanner and SQLite. A
  prefix match needs only an ordinary index, the same on all three, so users
  have one. The contract depends on neither.
