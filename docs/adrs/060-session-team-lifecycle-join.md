# ADR 060: Sessions Join Teams Through Lifecycle Ownership

> **Status:** Accepted
> **Date:** 2026-09-01
> **Context:** `POST /sessions/query` team filter (#749); session revocation scope
> **Builds on:** [ADR 024](024-user-team-lifecycle-ownership.md) (lifecycle
> ownership is separate from team membership),
> [ADR 010](010-session-auth-attempt-check-model.md) (session persistence model)

## Problem

A session carries no team. `sessions` has `project_id`, `user_id`, a user agent
and its checks — nothing that names a team, and no join table pointing at one.
So "list the sessions of my team" had no answer, and #749 could not be
implemented before the data model was decided.

Three relations could carry the word "team" here:

1. **Roster membership** — the user is on the team's roster
   (`team_memberships`). #749's specification guessed at this one ("likely
   session → user → team membership").
2. **Lifecycle ownership** — the team manages the user's identity
   (`users.lifecycle_owner_team_id`, [ADR 024](024-user-team-lifecycle-ownership.md)).
3. **An explicit session→team binding** — a `team_sessions` join table, the
   OAuth2 `scope` shape. No such table exists; it is the #975 plan.

The three split exactly at the interesting users: a rostered external
collaborator (membership yes, ownership no), and a managed user who is not on
the roster (ownership yes, membership no).

## Decision

**A session joins a team through its bound user's lifecycle owner. The link is
derived at read time and never stored.**

```
sessions.user_id  →  users.lifecycle_owner_team_id  →  teams
```

Rules:

- **A session stays project-scoped.** It is created by `POST /sessions` against a
  project and is never bound to a team.
- **At most one team per session.** Every user has exactly one lifecycle owner
  ([ADR 024](024-user-team-lifecycle-ownership.md)) — a team, or themselves — so
  a session surfaces under one team or none. Roster membership does not add a
  team to that answer.
- **Self-owned, no team.** A self-serve user's sessions belong to no team, even
  when that user sits on several rosters.
- **No user, no team.** A session with `user_id IS NULL` — the anonymous shell,
  or a factor-verified pre-auth session from a password-only exchange — matches
  no team filter.
- **Ownership is read live.** Ownership changes are visible on the next query,
  without touching the session itself. Deactivating a user drops their
  memberships but not their owner, so their still-live sessions stay visible to
  the team that has to account for them.

### Why ownership and not membership

The filter's answer has to be the same set the caller can act on. Revocation is
the action, and lifecycle ownership is what confers it:
[ADR 024](024-user-team-lifecycle-ownership.md) makes deleting a user — "revoke
sessions, tokens, and credentials" — the owning team's operation. A membership
row for a user the team does not own carries no action: the team cannot end that
session, and its actual remedy, removing the membership, needs no session list.

The concrete use cases line up the same way:

- **Offboarding.** The owning team deactivates the user and needs to see that no
  session outlived it.
- **A compromised account.** The owning team kills the sessions; other teams the
  user collaborates with are untouched, and could not have done it anyway.
- **Compliance.** "No session survives deactivation" is only answerable per
  owning team, because only the owner deactivates.
- **Agents** ([#288](https://github.com/zitadel/nextgen/issues/288)). An agent
  identity owned by a team is exactly the principal that team watches and kills.
- **Support.** "I can't log in" is user-rooted and wants the `user_id` filter.
  "Team X's people can't log in" correlates with that tenant's IdP, SSO or
  provisioning — which produces lifecycle-owned users
  ([ADR 024](024-user-team-lifecycle-ownership.md): directory/SCIM provisioning
  for one customer tenant creates team-owned users). A guest on the roster
  authenticates in their own context and is not part of that failure.

The cases that sound like membership have better surfaces than a session list: a
suspended member has already lost access (permissions resolve per check); "who
accessed us during the incident" is an events question, since a session list
cannot see the past; "who can access us" is the roster itself. The one genuine
sweep — every session of everyone associated with a team — composes from the
users query's membership filter plus the sessions `user_id` filter, two hops
that stay properly permissioned.

That permission point is the last argument, and it is why membership is not
merely redundant here. A help-desk principal may hold `user.read` without
membership read, and a SIEM key may hold `session.read` alone; an ungated
membership filter would let either enumerate every team's roster, one bit per
returned row. This is settled elsewhere in the API: the users query's `team_id`
filter and `expand: ["teams"]` are gated behind `team_membership.read`
(`requireMembershipRead`, #1004, [system-permission-catalog.md](../design/api/system-permission-catalog.md)),
so a membership lens on sessions would have to grow the same gate or contradict
it. The ownership filter needs no gate: it filters along the relation that
scopes the caller anyway, and the owning team id is already on every user the
caller can read.

The comparison drawn in review, finally: no comparable product exposes
roster → global sessions either. GitHub shows org admins only the org-bound SSO
sessions (the shape of [#975](https://github.com/zitadel/nextgen/issues/975)),
Workspace and EMU show sessions to the account owner, and Auth0 has no org
session list at all.

### Data model

**No new tables or columns.** `users.lifecycle_owner_team_id` already carries the
relation, and migration 000011 already indexes it
([ADR 024](024-user-team-lifecycle-ownership.md)): PostgreSQL on
`(project_id, lifecycle_owner_team_id)` where the column is not null, Spanner on
`(lifecycle_owner_team_id)`.

**It does ship a migration, though** — `000019_sessions_sort_index` on
PostgreSQL, `000021` on Spanner, `000005` on SQLite. It is index-only: two on
`sessions`, `(project_id, created_at, id)` for the default sort and
`(project_id, user_id)` for the drive side of a selective team, plus, on SQLite
alone, the `users` lifecycle-owner index the other two dialects already had from
000011. No column, constraint or table changes, so the row shape and the write
path are untouched, and both directions are reversible. Why both session indexes
are load-bearing is Performance below; the short version is that they cover
opposite team selectivities and neither one alone is enough.

The filter compiles to a correlated `EXISTS` in the session list's inner
sub-query, where the alias `s` is the raw `sessions` table:

```sql
SELECT s.* FROM sessions s
WHERE s.project_id = $1
  AND EXISTS (SELECT 1 FROM users u
              WHERE u.project_id = s.project_id
                AND u.id         = s.user_id
                AND u.lifecycle_owner_team_id = $2)
ORDER BY … LIMIT …
```

Both correlation columns are the `users` primary key and the team side is
equality-bound, so the planner has two good shapes available and picks by
selectivity: probe `users` per candidate session for a broad team, or drive from
the owned users into `sessions` for a narrow one (measured plans below).
`s.user_id IS NULL` makes the correlation NULL, so `EXISTS` is false and
anonymous sessions fall out with no special case; a self-owned user's NULL
`lifecycle_owner_team_id` never equals a bound team id, so those fall out too.

`lifecycle_owner_team_id` is **filter only**. A team matches many sessions and
the value lives on another table, so it can never be an `ORDER BY` or cursor
column ([ADR 027](027-cursor-based-pagination.md)); `sessionSortField` rejects
it.

Only `equals` is supported. `not_equals` returns `not_implemented`, and the
substring and ordering operations return `invalid_request` — the binding is a
correlated sub-query taking exactly one team id, so there is nothing for a `LIKE`
to match against.

### The wire name

The field is `lifecycle_owner_team_id`, not `team_id`. Three relations can be
called "a session's team" (above), two of them may eventually be filterable, and
the released contract cannot take the ambiguous name for one of them.

The name matches the users query, which now carries both lenses side by side
(#984, #1004, #1071): `lifecycle_owner_team_id` for ownership and
`metadata.lifecycle_owner_team_id` on the envelope — the same relation seen from
the other side — and `team_id`, gated, for membership.

That leaves one open naming question, deliberately not settled here: on users,
`team_id` means membership; on sessions this ADR leaves `team_id` unclaimed,
because unlike a user, a session will get a team relation of its own if the
explicit binding of [#975](https://github.com/zitadel/nextgen/issues/975) lands,
and that binding has the better claim to the plain name. A roster filter on
sessions — should a use case ever justify one — therefore has to pick between
`member_of_team_id` (leaving room for the binding) and `team_id` (parity with
users), and whoever adds it owns that call. Nothing shipping here depends on it:
both names are still free.

### How the filter reaches the storage layer

Filters are data (`database.Filter[domain.SessionField]`), resolved through a
per-dialect `database.Schema` that maps a domain field to its SQL. A binding
marked `Computed` supplies an expression instead of a column reference — sessions
already do this for `SessionFieldHasVerifiedFactors`, the correlated `EXISTS`
behind the `state` filter.

Every filter compiler wrote the bound value at a **fixed position relative to the
column**: `<col> = $N`, or `$N = ANY(<col>)`. The ownership predicate needs the
value *inside* the expression, which no branch could produce.

So `FieldBinding` gained an optional `SQLSuffix`, and `database.CorrelatedEqual`
compiles as `SQLName` → bound value → `SQLSuffix`. The dialect-specific text
stays in the dialect's schema map, exactly where `HasVerifiedFactors` already
keeps it, and the compile branch is identical on PostgreSQL, Spanner and SQLite —
so it lives once in `internal/storage/dialect/compare`, and `stmttest` asserts
one behavior rather than three.

The filter stays a first-class `database.Filter`: it ANDs with the project scope,
the `state` predicate and the keyset cursor with no special handling, and
`ListSessions`' signature is untouched.

## Performance

Measured on PostgreSQL 18.3 (the version the integration containers run) against
seeded data: 2M sessions and 200k users in the queried project, plus an
equal-sized decoy project so the `project_id` predicate has something to exclude,
and one verified check on every second session so the `state` predicate's own
`EXISTS` has something to find. Ownership is deliberately skewed: one team owns
40% of the project's users, one owns 1%, one owns 3, and the rest are
self-owned. Median of three warm runs of `EXPLAIN (ANALYZE, BUFFERS)` over the
statement `ListSessions` compiles, first page of 20 in the default
`created_at DESC, id DESC` order.

| 2M sessions, first page of 20 | no index | sort index only | both (000018) |
|---|---:|---:|---:|
| no filter (baseline) | 127 ms | 0.57 ms | 0.44 ms |
| team filter, 40%-of-project team | 215 ms | 0.74 ms | 0.81 ms |
| team filter, 1% team | 123 ms | 5.9 ms | 8.8 ms |
| team filter, 3-user team | 111 ms | 116 ms | 0.47 ms |
| team filter, team owning nobody | 15.7 ms | 15.6 ms | 0.41 ms |
| team filter + `state=active` | 76 ms | 77 ms | 38 ms |
| team filter, cursor at page 50 | 128 ms | 5.1 ms | 6.0 ms |

**The team filter is not what costs.** Before any index work, filtering by team
cost the same order as not filtering at all — both were dominated by the same
thing: `sessions` carried only `PRIMARY KEY (project_id, id)` and the partial
unique index on `token_id`, so **every** page of `POST /sessions/query` scanned
and sorted a project's whole session table before applying `LIMIT`.

Migration `000019_sessions_sort_index` (and its Spanner/SQLite peers) therefore
adds **two** indexes, and both are load-bearing because they serve opposite
selectivities of this filter:

- `(project_id, created_at, id)` serves the default sort. Alone, it is the large
  win for the unfiltered list and for a team owning much of the project: the
  planner walks the index backwards and probes `users` by primary key per
  candidate row (memoized), so the first 20 matches are found after ~2000 rows
  for the 1% team.
- `(project_id, user_id)` lets a *selective* team drive the other way — a bitmap
  scan of `idx_users_lifecycle_owner_team_id` for the owned users, then an index
  scan into `sessions` per user. Without it, the sort index alone leaves the
  3-user team at 116 ms, no better than having no index at all, because the walk
  in `created_at` order crosses most of the table before it collects 20 matching
  rows. With both, that case is 0.47 ms.

Two findings worth carrying forward:

- **Combining the team filter with `state` is the worst case.** Both compile to
  correlated `EXISTS`, and the plan the planner picks (drive from the owned
  users, filter `expires_at`, semi-join `checks`) reads ~20k blocks for 17 rows —
  38 ms, against 0.44 ms for the same page unfiltered. It is the one shape where
  two computed `EXISTS` predicates on one list produce a plan neither produces
  alone; it is bounded, and it is the case to watch if a third computed
  predicate is ever added.
- **A team that owns nobody is not free without the membership-side index**
  (15.7 ms), because the planner has nothing to prove emptiness with and walks
  the sort index to the end. With both indexes it is a single empty bitmap scan,
  0.41 ms.

`sessionSortField` also allows sorting by `user_id`; `(project_id, user_id)`
serves that too, so no third index was added.

Prepared statements were checked separately: pgx executes this through its
statement cache, and the plan stays stable past the sixth execution where
PostgreSQL may switch to a generic plan.

## Revocation scope — project level only

**This model supports project-level session revocation only.**

`DELETE /sessions/{id}` ends the session outright: the row goes, its tokens are
revoked, and the user is signed out of the project and therefore out of every
team. There is no way to express "end this session's access to team A while
leaving B and C alone", because the session holds no per-team state to remove.

What the ownership join does fix is the mismatch the membership join would have
shipped: every row a team sees is now a row that team may act on. Authorization
is still enforced on the action rather than inferred from the listing —
`RevokeSession` gates on `requireResourceAccess(…, sessionAccess, opDelete)`,
which is resource-scoped — and tightening that gate to read lifecycle ownership
is authorization work tracked separately. But the filter and the revoke
authority now describe the same relation, instead of two different ones.

Consequently the product surface must keep the two actions visibly distinct:
removing a member from a team changes that team's access and nothing else;
revoking a session ends the whole session. They are not substitutes.

## Follow-up: explicit session-to-team binding

> Tracked by [#975](https://github.com/zitadel/nextgen/issues/975).

Team-scoped revocation and scoped agent sessions both require the explicit model:
a `team_sessions` join table binding individual sessions to teams, so a session
can carry a subset of the teams its user reaches. That is a contract change, not
just a table — session creation and the exchange flow have to decide which teams
a new session is bound to, and the permission resolver has to consult the
binding — and it belongs in its own ADR. The DDL sketch lives in the issue.

Two notes for whoever picks it up:

- The binding is a **third** filter, not a replacement for this one. #975's
  acceptance criterion says the team filter may later "read the binding instead
  of (or in addition to) roster membership"; with the ownership lens shipped,
  the binding gets its own field — `team_id`, the name this ADR deliberately
  leaves unclaimed — and `lifecycle_owner_team_id` keeps meaning what it says.
- The binding cannot answer the offboarding and compliance questions above. It
  says which teams a session may reach, not who is accountable for the identity
  behind it, and a user's sessions can be bound to zero teams while the owner
  still has to account for them.

## Alternatives considered

**Roster membership** — the join #749 guessed at, implemented and then dropped
before release. Rejected on the reasoning in "Why ownership and not membership":
it answers a question with no action attached, misses the managed user who is
not on the roster, and would need a `team_membership.read` gate the ownership
filter does not. If a use case for it does appear, it ships as a second,
gated field named `member_of_team_id`, not as a redefinition of this one.

**Explicit binding now** — deferred, not rejected; see the follow-up above. It
models more use cases, but it couples authorization to the session and obliges
every authentication flow to manage a relationship no current product
requirement needs.

**Filter on the roster, restricted to `active` memberships**, mirroring the
authz edge projection (`MembershipStatus.IsAuthzActive`). Narrower than the full
roster, but it inherits every objection to the roster lens and adds one: it
hides the suspended member whose session is still live.

**Reuse `database.ArrayContains`** with a binding yielding the user's team-id
set, avoiding any new filter API. Rejected: SQLite's compiler hard-codes
`json_each`, so its binding would have to build a JSON array and re-parse it per
session row — losing the point lookup, and stretching `ArrayContains`' documented
meaning ("array *column* contains value") into a trap.

**A `SessionQueryOptions{TeamID}` statement argument**, following
`ListJSONSchemas`' `LatestRevisionPerObjectType` conjunct. Rejected: it changes
the statement signature across three dialects and both test suites, and takes the
team out of the filter model so it can no longer be composed — while forcing the
service to hoist one filter out of the generic filter list.

**Resolve the team's users in the service, then filter `user_id IN (…)`.**
Rejected: two round trips, an unbounded `IN` list, and a race between the reads.
