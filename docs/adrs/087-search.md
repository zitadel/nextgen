# ADR 087: Search

> **Status:** Proposed (amended 2026-11-10: a session searches across its
> projects, and every type matches from an index, see
> [Amendment](#amendment-2026-11-10-across-projects-every-match-from-an-index))
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
| `schema` | a user schema's `title` and `objectType`, as a substring | the title, else the object type, else the id | the object type, under a title |
| `flow_definition` | the name, as a substring | the name | the purposes it handles |
| `idp` | a connection's `slug` and `display_name`, as a substring | the display name, else the slug | the slug, under a display name |

- Text that is the id of a resource of a searched type is found as that id.
- Matching ignores case.
- A schema and a flow definition are found at their newest revision, and the
  result carries that revision's id.
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

The lists of schemas, flow definitions and identity providers cannot filter on
the text a person knows them by: a schema's title and a connection's display
name live inside their documents, and a flow's name matches only whole. Search
reads one page of each (100 rows, newest revisions only) and matches it in the
server. A project holds a handful of each; one with more than a page is
reported in `incomplete_types`.

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

- More types: applications once they can be listed, then releases and
  deployments.
- Text inside a value: an email's domain, a word after the first of a name.
- The same index for a team's name.
- Search across the projects a person can act on, by leaving out `project_id`
  on a session; `project_id` on every result is there for it. Done by the
  amendment below.
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

## Amendment (2026-11-10): across projects, every match from an index

Leaving out `project_id` on a session now searches the projects the person can
act on. That widens every read by a factor of projects, so none of them may
scan: the team match read every team of the project, and schemas, flow
definitions and identity providers matched one page in the server. Each now
matches from an index on Postgres, Spanner and SQLite. Supersedes §5, and
amends §1 and §4.

### 6. A session without `project_id` searches its projects

- The projects are those `listMyProjects` (`GET /users/me/projects`) lists:
  the ones the person's project-scoped grants reach, and every project for a
  platform operator ([ADR 075](075-platform-operators.md)). A grant scoped to
  one team lists no project, there or here.
- A search reads the newest 10 of them, by when each project was created, as
  the console's Projects list reads them. `projects (created_at, id)` serves
  that order on all three dialects, so a platform operator's search costs what
  a person's with 10 projects does. The response says `more_projects` when
  there are more, and lists every requested type in `incomplete_types`; naming
  a project searches that one.
- Each project costs one access check, and its decision gates every type read
  in it, as that type's own list would gate it. A listed project the person
  cannot read is left out. Projects are checked and read side by side, at most
  4 at a time, each read with a context of its own.
- `limit_per_type` counts the matches of all projects together, and every
  result carries its `project_id`.
- A project secret, and any request naming `project_id`, searches one project
  as before.

### 7. Every type matches from an index

Users keep their index ([ADR 058](058-user-identity-designation-and-references.md)).
Teams, user schemas, flow definitions and identity provider connections get
one table, `search_entries`, written by the statements that write the
resource, in their transaction, as the resource scope index is:

- A resource has one row per text it is found by: each of its names, folded
  as uniqueness folds (`domain.SearchText`, at most 256 characters), and the
  name's tail from each of its next eight words. "Partner Staff" is
  `partner staff` and `staff`; a word starts at a letter or digit after a
  character that is neither, so `partner-sso` is also `sso`.
- The primary key is `(project_id, resource_kind, search_text,
  resource_key)`. A search is one range of it, read in key order to a fixed
  limit, so it costs the same in a project of three teams and in one of a
  million. A caller whose grant covers part of the project reads the same
  rows: whether it may see a row is a column of the read, not a condition of
  it, so the grant drops rows from the page and never walks the range for the
  ones it may see. A range that held the limit leaves the type incomplete. Each dialect compares the text by code point (Postgres collation
  `C`, Spanner's STRING order, SQLite's bytes), and Spanner reads the table
  itself.
- A row carries what search answers with: the id, the title and the subtitle.
  `resource_key` is what a newer revision replaces an entry by (a schema's
  object type, a flow's name, else the id), so an entry always names the
  newest revision; deleting that revision points it at the newest left. Its
  texts are upserted, so two revisions of one key written at once both
  commit, and the entry names the later one.
- An id is still read by its primary key, through the type's list, and only
  text shaped like one is tried: an id with the type's prefix, or for a schema
  an absolute URI.

What changes for the person typing: these types match from the start of a
name or of a word in it, no longer inside a word. `staff` finds "Partner
Staff", `pay` no longer finds "Prepay", and `%` starts no word. Ranking is a
whole name, then the start of a name, then the start of a later word.

### Read plan

A session's search without `project_id`, for every type, at the default
`limit_per_type` of 5, reads in each of at most 10 projects:

| Read | Statements | Rows |
| --- | --- | --- |
| Access check | 2: the active catalog, the check | the person's grants on the project |
| `user` | 1 per designated property, plus the schema read and the user refs of ADR 058 | per property at most 6 × the properties one schema designates (18 for three) index entries, then those users |
| `team`, `schema`, `flow_definition`, `idp` | 1 each | at most 24 rows of `search_entries` each |
| An id | 1 by primary key | 1 |

Before them, two reads: the session's user, by primary key, and the projects,
from the person's grants or, for an operator, the newest 11 from
`idx_projects_created_at`. Nothing grows with the number of users, teams or
configuration rows a project holds, or with how narrow the caller's grant is
for those four types. Measured on Postgres with 10 projects and every type,
one search is 107 statements. Read 4 projects at a time, the longest chain
of them run one after another is about 40, where reading every project in
turn ran all 107 in a row (locally a median of 3.3 ms against 5.8 ms).

Two costs stay. The user read lists every user schema revision of the project
to learn which properties are searched. And its index ranges keep a narrow
grant's filter in their condition, as the users list does
([ADR 058](058-user-identity-designation-and-references.md)), so a caller
whose grant covers part of a project reads past the users it may not see.

