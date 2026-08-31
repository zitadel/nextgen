# ADR 056: Sessions Join Teams Through User Membership

> **Status:** Accepted
> **Date:** 2026-08-25
> **Context:** `POST /sessions/query` team filter (#749); session revocation scope
> **Builds on:** [ADR 024](024-user-team-lifecycle-ownership.md) (team membership
> is separate from lifecycle ownership),
> [ADR 010](010-session-auth-attempt-check-model.md) (session persistence model)

## Problem

A session carries no team. `sessions` has `project_id`, `user_id`, a user agent
and its checks — nothing that names a team, and no join table pointing at one.
So "list the sessions of my team" had no answer, and #749 could not be
implemented before the data model was decided.

Two models were on the table.

**Implicit.** A session is project-scoped and surfaces under every team its user
currently belongs to. Nothing is stored; team membership is read at query time.

**Explicit.** A `team_sessions` join table binds individual sessions to teams, so
a session can carry a *subset* of the teams its user belongs to — the OAuth2
`scope` shape. Two cases motivated it:

1. **Privilege inversion.** Under the implicit model, revocation is still
   project-wide. A team admin who revokes a session seen in their team logs the
   user out of every other team too — including a project admin who happens to
   be a member of that team. A lower-privileged principal can evict a
   higher-privileged one.
2. **Scoped agent sessions.** An AI agent with permissions across many teams
   should be able to hold a session valid for only the team it was tasked
   against, so a mistake cannot reach the others.

Both are real. Neither is a session *listing* problem, and the explicit model
adds a relationship every authentication flow would then have to populate and
maintain. Team access is currently answered by membership and permissions, not
by the session — and the implicit model is what the API contract, the console
and the permission engine already assume.

## Decision

**A session joins a team through its bound user's roster membership. The link is
derived at read time and never stored.**

```
sessions.user_id  →  team_memberships (project_id, user_id, team_id)  →  teams
```

Rules:

- **A session stays project-scoped.** It is created by `POST /sessions` against a
  project and is never bound to a team.
- **One session, every team.** A user on teams A, B and C has one session, and
  that same session appears when filtering by any of the three.
- **No user, no team.** A session with `user_id IS NULL` — the anonymous shell,
  or a factor-verified pre-auth session from a password-only exchange — belongs
  to no team and matches no team filter.
- **Roster statuses match; `removed` does not.** `pending`, `active` and
  `inactive` all surface the session
  (`domain.RosterMembershipStatuses`); a removed membership is history, not
  roster. A suspended member's still-live session therefore stays visible to the
  team admin, which is the case an admin most needs to see.
- **Membership is read live.** Removing a user from a team removes their sessions
  from that team's view on the next query, without touching the session itself or
  the user's other teams.

### Data model

**No new tables or columns.** `team_memberships` already carries everything the
join needs, keyed `(project_id, team_id, user_id)` with the roster `status`
([ADR 024](024-user-team-lifecycle-ownership.md)). Two indexes were added on
`sessions` for the read path — see Performance below; they change no shape.

The filter compiles to a correlated `EXISTS` in the session list's inner
sub-query, where the alias `s` is the raw `sessions` table:

```sql
SELECT s.* FROM sessions s
WHERE s.project_id = $1
  AND EXISTS (SELECT 1 FROM team_memberships tm
              WHERE tm.project_id = s.project_id
                AND tm.user_id    = s.user_id
                AND tm.status IN ('pending', 'active', 'inactive')
                AND tm.team_id    = $2)
ORDER BY … LIMIT …
```

All three key columns are equality-bound, so the planner does not evaluate this
per session row: it rewrites the correlated `EXISTS` into a semi-join, resolves
the team side with **one** index scan on `team_memberships`' primary key, and
joins that against `sessions` (see Performance below for the measured plans).
`s.user_id IS NULL` makes the correlation NULL, so `EXISTS` is false and
anonymous sessions fall out with no special case.

`team_id` is **filter only**. A session matches many teams and a team matches
many sessions, so it can never be an `ORDER BY` or cursor column
([ADR 027](027-cursor-based-pagination.md)); `sessionSortField` rejects it.

Only `equals` is supported. `not_equals` returns `not_implemented`, and the
substring and ordering operations return `invalid_request` — the binding is a
correlated sub-query taking exactly one team id, so there is nothing for a `LIKE`
to match against.

### How the filter reaches the storage layer

Filters are data (`database.Filter[domain.SessionField]`), resolved through a
per-dialect `database.Schema` that maps a domain field to its SQL. A binding
marked `Computed` supplies an expression instead of a column reference — sessions
already do this for `SessionFieldHasVerifiedFactors`, the correlated `EXISTS`
behind the `state` filter.

Every filter compiler wrote the bound value at a **fixed position relative to the
column**: `<col> = $N`, or `$N = ANY(<col>)`. The team predicate needs the value
*inside* the expression, which no branch could produce.

So `FieldBinding` gained an optional `SQLSuffix`, and `database.CorrelatedEqual`
compiles as `SQLName` → bound value → `SQLSuffix`. The dialect-specific text
stays in the dialect's schema map, exactly where `HasVerifiedFactors` already
keeps it, and the compile branch is identical on PostgreSQL, Spanner and SQLite —
so it lives once in `internal/storage/dialect/compare`, and `stmttest` asserts
one behavior rather than three.

`team_id` stays a first-class `database.Filter`: it ANDs with the project scope,
the `state` predicate and the keyset cursor with no special handling, and
`ListSessions`' signature is untouched.

## Performance

Measured on PostgreSQL 18.3 against seeded data at three scales (20k / 200k / 2M
sessions per project, plus an equal-sized decoy project so the `project_id`
predicate has something to exclude). Team sizes deliberately skewed: one team
holding 40% of users, one at 1%, one with 3 members. Median of three warm runs,
`EXPLAIN (ANALYZE, BUFFERS)` on the statement captured from the server log while
`ListSessions` actually ran.

**The team filter is not what costs.** Before any index work, filtering by team
cost the same as not filtering at all — both were dominated by the same thing:
`sessions` carried only `PRIMARY KEY (project_id, id)` and the partial unique
index on `token_id`, so **every** page of `POST /sessions/query` scanned and
sorted a project's whole session table before applying `LIMIT`.

| 2M sessions, first page of 20 | no index | with 000018 |
|---|---:|---:|
| no filter (baseline) | 130 ms | 0.33 ms |
| team filter, 40%-of-project team | 215 ms | 1.7 ms |
| team filter, 1% team | 142 ms | 8.1 ms |
| team filter, 3-member team | 141 ms | 0.38 ms |
| team filter + `state=active` | 112 ms | 31 ms |
| team filter, cursor at page 50 | 149 ms | 6.1 ms |

Migration `000018_sessions_sort_index` (and its Spanner/SQLite peers) therefore
adds **two** indexes, and both are load-bearing because they cover opposite
selectivities of this filter:

- `(project_id, created_at, id)` serves the default sort. Alone, it is a large
  win for the unfiltered list and for teams holding much of the project.
- `(project_id, user_id)` lets a *selective* team drive from `team_memberships`
  into `sessions`. Without it, the sort index alone makes a 3-member team
  **worse than no index at all** — 1158 ms against the pre-index 141 ms, because
  the walk in `created_at` order crosses most of the table before it collects 20
  matching rows. With both, that case is 0.38 ms.

Two findings worth carrying forward:

- **Combining `team_id` with `state` was the worst case by far.** Both compile to
  correlated `EXISTS`, and at one scale the planner joined the two semi-join
  sources *to each other* before touching `sessions` — 8M intermediate rows and
  40M buffer hits for a 10.5 s query returning nothing. The membership index
  removes it (10502 ms → 5 ms), but the shape is worth remembering: two computed
  `EXISTS` predicates on one list can produce a plan neither one produces alone.
- **One case regresses.** A team holding ~40% of a 200k-session project goes from
  30 ms to 47 ms, because the planner drives from membership into sessions and
  materializes 72k rows before the top-N sort (it estimates 151). Raising the
  statistics target on `team_memberships.team_id` does not change it. It is
  bounded, it does not reproduce at 2M, and it is the price of the 3300× win on
  selective teams — but it is a real cost, recorded here rather than smoothed over.

`sessionSortField` also allows sorting by `user_id`; `(project_id, user_id)`
serves that too, so no third index was added.

Prepared statements were checked separately: pgx executes this through its
statement cache, and the plan stays stable and fast (~0.1 ms) past the sixth
execution where PostgreSQL may switch to a generic plan.

## Revocation scope — project level only

**This model supports project-level session revocation only.**

`DELETE /sessions/{id}` ends the session outright: the row goes, its tokens are
revoked, and the user is signed out of the project and therefore out of every
team. There is no way to express "end this session's access to team A while
leaving B and C alone", because the session holds no per-team state to remove.

The privilege-inversion concern above is therefore **not** solved by the data
model. Today's mitigation is authorization on the revoke action rather than
scoping: `RevokeSession` gates on `requireResourceAccess(…, sessionAccess,
opDelete)`, which is resource-scoped, not team-scoped. Seeing a session from a
team context must not by itself confer the right to revoke it, and lifecycle
ownership ([ADR 024](024-user-team-lifecycle-ownership.md)) is the natural input
to that permission — a team that owns a user's lifecycle may revoke their
sessions; bare membership in a shared team may not. Tightening that permission is
authorization work, tracked separately from this ADR.

Consequently the product surface must keep the two actions visibly distinct:
removing a member from a team changes that team's access and nothing else;
revoking a session ends the whole session. They are not substitutes.

## Follow-up: explicit session-to-team binding

> Tracked by [#975](https://github.com/zitadel/nextgen/issues/975).

Team-scoped revocation and scoped agent sessions both require the explicit model.
When a use case demands either, add a join table rather than a column — a session
can be in many teams:

```sql
-- team_sessions is a many-to-many relation for sessions and teams.
CREATE TABLE zitadel_nextgen.team_sessions (
    project_id  TEXT COLLATE "C" NOT NULL,
    team_id     TEXT COLLATE "C" NOT NULL,
    user_id     TEXT COLLATE "C" NOT NULL,
    session_id  TEXT COLLATE "C" NOT NULL,

    FOREIGN KEY (project_id, session_id)
        REFERENCES zitadel_nextgen.sessions (project_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (project_id, team_id, user_id)
        REFERENCES zitadel_nextgen.team_memberships (project_id, team_id, user_id)
        ON DELETE CASCADE
);
```

The second foreign key is the load-bearing part: pointing at
`team_memberships`' full primary key means a session can never be bound to a team
its user is not a member of, and losing the membership cascades the binding away.
Deleting one `team_sessions` row is then team-scoped revocation — it ends that
session's access to that team and nothing else.

Adopting it is a contract change, not just a table: session creation and the
exchange flow have to decide which teams a new session is bound to, the
permission resolver has to consult the binding, and a session bound to no team
becomes unusable for team resources. That design belongs in its own ADR.

## Alternatives considered

**Explicit binding now** — deferred, not rejected. It models more use cases, but
it couples authorization to the session and obliges every authentication flow to
manage a relationship no current product requirement needs. The DDL above is
preserved so adopting it later is a migration, not a redesign.

**Filter only on `active` memberships**, mirroring the authz edge projection
(`MembershipStatus.IsAuthzActive`, the status that writes an
`authz_membership_edges` row). Narrower and defensible — a session would surface
under a team only while the membership actually grants access — but it diverges
from the roster the admin is looking at, and hides exactly the suspended-member
session that is worth seeing.

**Reuse `database.ArrayContains`** with a binding yielding the user's team-id
set, avoiding any new filter API. Rejected: SQLite's compiler hard-codes
`json_each`, so its binding would have to build a JSON array of the user's teams
and re-parse it per session row — losing the point lookup, and stretching
`ArrayContains`' documented meaning ("array *column* contains value") into a trap.

**A `SessionQueryOptions{TeamID}` statement argument**, following
`ListJSONSchemas`' `LatestRevisionPerObjectType` conjunct. Rejected: it changes
the statement signature across three dialects and both test suites, and takes
`team_id` out of the filter model so it can no longer be composed — while forcing
the service to hoist one filter out of the generic filter list.

**Resolve the team's members in the service, then filter `user_id IN (…)`.**
Rejected: two round trips, an unbounded `IN` list, and a race between the reads.
