# Plan: team membership on the users API

Three capabilities, one naming cleanup:

1. **Query** users with structured filters, including team membership
   (`POST /users/query`, ADR 031).
2. **Optionally expand** each user's team roster inline.
3. Gate the roster behind `team_membership.read`.
4. Make all of it unambiguously *not* `lifecycle_owner_team_id`.

Delivered as a stack of five PRs (§6).

---

## 0. The naming problem (do this first)

`team_id` is a query parameter on two user endpoints, doing two different
things — both of them membership, neither of them ownership:

| Endpoint | Meaning | Code |
|---|---|---|
| `POST /users?team_id=` | Puts the new user on that team's **roster**, and scopes team-unique attributes | `CreateUserParams.TeamID` → `CreateUser.InitialMembershipTeamID` → an active `team_memberships` row |
| `GET /users/{user_id}?team_id=` | Requires an **active membership** | `UserQueryOptions.MembershipTeamID` |

Both `$ref` the same `api/openapi/components/parameters/team-id.yaml`, described
only as "The unique identifier of the team".

**Lifecycle ownership is not settable through the API at all.**
`domain.User.LifecycleOwnerTeamID` is written only by storage read-back and
emitted by `domainUserToApiUser`; no handler sets it. So `team_id` is not
ambiguous between ownership and membership on the wire — it is simply vague,
and vague in a way that invites the reading "the team that owns this user",
because the response next to it carries `metadata.lifecycle_owner_team_id`.

This gets sharper with `POST /users/query`: `lifecycle_owner_team_id` is a real
column (`domain.UserFieldLifecycleOwnerTeamID`, `internal/domain/user.go:249`),
so it is a natural filter *and* sort field. Membership is a different filter
against a different table. Both land in the same filter-field enum, side by
side, where any ambiguity is maximally expensive.

ADR 024 already draws the line, and `user-metadata.yaml` states it well:
lifecycle ownership decides *who may deprovision the user*; the roster decides
*which teams the user collaborates in*.

**Decision:** split the shared parameter into two named ones. Different names
rather than one, because the two do different things — create *writes* a
membership, get *filters* by one.

- `components/parameters/initial-membership-team-id.yaml` — name
  `initial_membership_team_id`, used by `POST /users`. Mirrors the domain field
  it already feeds.
- `components/parameters/member-of-team-id.yaml` — name `member_of_team_id`,
  used by `GET /users/{user_id}`, and later the filter-field enum in §1.

Each description states what it is *and* what it is not, pointing at ADR 024,
and says outright that lifecycle ownership cannot be set here.

**Status: shipped in PR 1** — #980.

The app is pre-production, so both renames are straight substitutions with no
compatibility shim.

`team-id.yaml` is **kept**, not deleted: `POST /schemas`
(`endpoints/schemas/methods.yaml:18`) and `GET /schemas/{id}`
(`endpoints/schemas/by_id/methods.yaml:19`) also reference it, where `team_id`
is a schema-ownership scope — a third distinct meaning. Untangling that is out
of scope here; this plan only stops the *user* endpoints from adding to the
pile. Worth filing separately.

---

## 1. `POST /users/query` (ADR 031)

ADR 031 is explicit that `GET` carries no filter/sort and that structured
querying lives at `POST /<resource>/query`. So the membership filter is a
**filter field in the request body**, not a query parameter.

Reference implementation is `POST /sessions/query` (ADR 027), with
`POST /teams/query` as the second example.

### `GET /users` is removed

`POST /users/query` replaces it outright. Projects and teams have no `GET`
collection at all — `system-permission-catalog.md:109` states it plainly for
projects ("Listing is `POST /projects/query` — there is no `GET /projects`"),
and `team.read` at line 155 lists only `POST /teams/query`, `GET /teams/{id}`.
`GET /users` is the lone outlier. Keeping both would mean two list surfaces
with different capabilities, and the filterable one immediately becomes the
only one anybody uses.

Remove the whole mechanism, not a deprecated shell: the path, the handler,
`list-users-response.yaml`, `listUsers-error-response.yaml`, the generated
`ListUsersParams`, and the mock's GET handler all go. Pre-production, so no
deprecation window.

Six consumers migrate to `queryUsers`:

| Consumer | Call |
|---|---|
| `apps/cli/src/commands/status.ts:196` | `listUsers({ limit: 1 })` presence probe |
| `apps/console/src/routes/_authed/users/index.tsx:44,168` | list route + `page_token` paging |
| `packages/testing/tests/integration/kit.test.ts:31` | `zitadel.api.listUsers()` |
| `packages/api-mock/src/platform-handlers.ts:690` | `http.get("*/users")` → `http.post("*/users/query")`, body-parsed instead of `ListUsersQueryParams` |
| `apps/cli/tests/unit/commands/status.test.ts:20,254,274`, `tests/integration/contract.test.ts:15` | msw `http.get` handlers |
| `internal/api/integration_test/user_list_test.go` | rewrite against `queryUsers` |

The CLI presence probe becomes an uncacheable POST. ADR 031 already accepted
that trade-off explicitly ("Where POST lacks, is in caching … it is a trade-off
we are willing to take"), and a `limit: 1` probe is cheap either way.

`GET /users/{user_id}` and `GET /users/{user_id}/teams` are untouched.

### Spec

New `api/openapi/endpoints/users/query/`, mirroring `endpoints/sessions/query/`:

- `methods.yaml` — `operationId: queryUsers`
- `query-users-request.yaml` — `limit`, `page_token`, `sorting`, `filter`,
  `expand`; copy the shape from `query-sessions-request.yaml`
- `query-users-response.yaml` — `users` + `next_page_token`
- `queryUsers-error-response.yaml` — generated by `gen_openapi_errors`
- `user-filter-field.yaml`, `user-sort-field.yaml`
- register `/users/query` in `openapi-spec.yaml` paths

**Two enums, not one.** Sessions splits filter fields from sort fields;
teams reuses one enum for both. Follow sessions. `session-sort-field.yaml`
gives the reason verbatim: *"Only stored columns are sortable: the keyset
cursor holds the last row's sort values, so a computed value would skip or
duplicate rows between pages."* `member_of_team_id` is not a stored column on
`users`, so it is filterable but **not** sortable.

```
user-filter-field.yaml:  created_at, id, schema, status,
                         lifecycle_owner_team_id, member_of_team_id
user-sort-field.yaml:    created_at, id, schema, status,
                         lifecycle_owner_team_id
```

The two team fields sit adjacent in the filter enum. Their descriptions carry
the ADR 024 distinction — this is the highest-leverage place for it.

**No `project_id` parameter.** `POST /teams/query` and `POST /projects/query`
take one, but the users list deliberately does not: it is bound to the token's
project by construction (`internal/api/user.go:60-70`). Carry that rationale —
and its handler comment — across to `QueryUsers`, since it diverges from the
other query endpoints on purpose.

### Handler

`QueryUsers` in `internal/api/user.go`, mirroring `QueryTeams`
(`internal/api/team.go:72`). The generic converters in `internal/api/list.go`
(`sortingToService`, `filterToService`) already take the endpoint's enum as a
type parameter, so they work unchanged.

### Service

`ListUsersInput` (`internal/service/user.go:44`) gains `Sorting *Sorting` and
`Filters []Filter`. The service method keeps its name — `ListUsers` is the
storage-layer verb too, and only the HTTP surface is changing.

Mirror the team implementation (`internal/service/team.go:105-215`):

- `userFilter(f Filter)` → `database.Filter[domain.UserField]`, same shape as
  `teamFilter`; unsupported operations return `domain.ErrNotImplemented`,
  bad field/operation/value combinations return `domain.ErrRequestInvalid`.
- `userField(field string)` → `domain.UserField` for sorting, rejecting
  `member_of_team_id` explicitly with a message saying it is filter-only.
- `listOrderBy(req.Sorting, domain.UserFieldCreatedAt, database.OrderDesc,
  userField, domain.UserFieldID)`. Note **`OrderDesc`** — the users list is
  newest-first today (`internal/service/user.go:205`), unlike teams' ascending
  default. Carry it over, or the console's user list silently reverses.

### The membership filter does not fit `database.Filter`

`database.Filter[domain.UserField]` binds to columns on `users` via
`v2user.Schema`. Membership lives in `team_memberships` and compiles to an
`EXISTS` subquery, carried out-of-band through
`UserQueryOptions.MembershipTeamID`.

There is already precedent for exactly this: `UserQueryOptions.Attributes` is
an out-of-band EAV match that compiles to `EXISTS` inside `ListUsers`, right
next to the membership clause. Some user filters go through `UserQueryOptions`
rather than `database.Filter`; that is the existing shape, not a new one.

So the service partitions before building:

```go
// splitUserFilters routes column predicates to database.Filter and
// membership predicates to UserQueryOptions.
func splitUserFilters([]Filter) ([]Filter, UserQueryOptions, error)
```

`member_of_team_id` accepts `equals` only — anything else is
`ErrRequestInvalid`. Repeating the field is `ErrRequestInvalid` too: the
storage option is a single `*string`, and ADR 031 ANDs filters, so two
different team ids would silently mean "the last one wins". Reject it rather
than pick.

### Storage: already done

`UserQueryOptions.MembershipTeamID` already compiles the `EXISTS` inside
`ListUsers`, in all three dialects:

- `internal/storage/dialect/postgres/user.go:227`
- `internal/storage/dialect/sqlite/user.go:169`
- `internal/storage/dialect/spanner/user.go:177`

No new SQL for the filter.

### Status semantics

The membership `EXISTS` hardcodes `MembershipStatusActive`. Roster reads
(`ListUserTeams`, `internal/service/user.go:262`) use
`domain.RosterMembershipStatuses` — pending, active, inactive.

Keep the filter active-only: "which users are actually in this team" is an
access question, and it matches `GET /users/{user_id}?member_of_team_id=`.
Say so in the enum description — a pending invitee will not match. Adding a
`membership_status` filter field later is the clean extension if it is needed.

---

## 2. Expansion: `expand=teams`

With `GET /users` gone, `expand` is a **body field on `POST /users/query`
only** — no query-parameter form is needed anywhere. The general pattern is
recorded in ADR 056 (§8).

`GET /users/{user_id}` is deliberately left without `expand`: a single user's
roster already has a dedicated paginated endpoint at
`GET /users/{user_id}/teams`, and expansion exists to kill the N+1 on a *list*.
Adding it there later is cheap — the hydrate works for one user — but it is not
in this plan.

### Contract

- **Values** — closed enum, only `teams` today. Unknown value is
  `400 req.invalid`, never a silent ignore.
- **Response** — `user.yaml` gains an optional top-level `teams`, items `$ref`
  the existing `endpoints/users/by_id/teams/user-team.yaml` (`id`, `name`,
  `membership_status`, `created_at`, `updated_at`). Reusing that schema keeps
  the expanded shape and `GET /users/{user_id}/teams` identical.
- **Absent vs empty** — omit `teams` entirely when not requested; emit `[]`
  when requested and the user has no teams. The client can tell "not asked"
  from "none".
- **Placement** — top level on `User`, not inside `metadata`.
  `lifecycle_owner_team_id` lives in `metadata`; putting the roster somewhere
  else is a second, structural statement that they are different concepts.
- **Cap** — expansion is not paginated. Cap at 10 teams and add
  `teams_truncated: boolean`. Past the cap, callers use
  `GET /users/{user_id}/teams`, which is cursor-paginated. Without a cap, page
  weight is unbounded — one user on 500 teams blows up a 20-user page.
- **Statuses** — full `RosterMembershipStatuses`, matching
  `GET /users/{user_id}/teams` exactly. Reuse the predicate builder from
  `internal/service/user.go:263-266`; do not re-derive it, or the two surfaces
  will silently disagree about who is on a roster.

Note the deliberate asymmetry: the *filter* is active-only, the *expansion*
shows the whole roster. Both descriptions must say which they use.

### Storage: hydrate, never join

`ListUsers` already runs base-query-then-batched-hydrate for EAV attributes
(`hydrateUsers`, `postgres/user.go:321`), grouping the page by project via
`v2user.GroupByProject` and issuing one `user_id = ANY($2)` per group. Team
expansion is a second hydrate of the same shape.

Joining teams into `userQuery` instead would break two things:

- `LIMIT` would count joined rows, not users — a user on 5 teams eats 5 of a
  20-row page.
- `NextCursor` (`internal/storage/user/list.go:56`) marshals the keyset from
  the last row; row fan-out corrupts it, and pages start skipping or repeating.

Hydrating after leaves `ORDER BY` and the cursor untouched, so a page token
stays valid whether or not `expand` is set. That is exactly why attributes
hydrate today.

### Changes

- **`internal/service/statement.go:225`** `UserQueryOptions`: add
  `IncludeTeams bool` and `TeamsLimit int`.
- **Three dialects** — new `hydrateUserTeams`, called from `ListUsers` right
  after `hydrateUsers`. One query per project group, joining
  `team_memberships m` to `teams t` for the team name, filtered to
  `RosterMembershipStatuses`, ordered `t.name, t.id` to match `ListUserTeams`.
  Fetch `cap+1` per user to set the truncation flag.
- **`internal/domain/user.go`** — `User` gains `Teams []UserTeam` plus a
  truncation flag. `domain.UserTeam` already exists.
- **`internal/api/user.go:232`** `domainUserToApiUser` — emit `teams` only when
  populated. Check every caller: `CreateUser`, `GetUserByID`, `GetMyUser` all
  route through it and must keep omitting the field.

---

## 3. Authorization: `team_membership.read`

**Decision taken:** roster data requires `team_membership.read` in addition to
`user.read`, per `system-permission-catalog.md:193` and the line-155 rule that
`team.read` does not imply `team_membership.*`. `GET /users/{user_id}/teams`
(`internal/api/user.go:138`), which today gates on user-read access only, is
tightened in the same PR so the two roster surfaces agree.

### What is actually enforceable today — read this before implementing

Two facts from the code that constrain how this lands:

1. **Declared scopes are not enforced.** `SecurityHandler.HandleOAuth2`
   (`internal/api/security.go:30`) ignores the operation's declared scopes
   entirely — it verifies the bearer introspects to a project secret and stops.
   The `security: oauth2: [user.read]` blocks throughout the spec are
   documentation, not a gate.
2. **No granular scopes are minted.** `ScopeContext.Scope` carries only
   `project.read` / `project.write` today (`internal/api/security.go:193`),
   and the live gate is a relation check — `checkProjectAccess` requires
   `project.write` as a ceiling, then runs `resolver.Check` on a project
   relation. ADR 036 says granular resource scopes arrive with PATs/service
   users later. There is also no `ResourceKindTeamMembership` in
   `internal/domain/authz.go:20-26`, so memberships have no RSI rows to check
   against.

A strict `team_membership.read` check written today would reject **every**
caller, because no token carries that scope. So implement it as a gate that is
correct now and tightens automatically later:

```go
// requireRosterRead gates roster reads (expand=teams, GET /users/{id}/teams).
// Granular resource scopes are not minted yet (ADR 036), so an operator
// project secret satisfies this today; once tokens carry team_membership.read
// the first branch becomes the only one that passes. TODO(#420).
func requireRosterRead(ctx context.Context) error
```

- Passes when `scopeCtx.Scope` contains `team_membership.read`.
- Otherwise passes when the credential is an operator project secret
  (`hasOperatorProjectWrite`, `internal/api/authz.go:308`) — the interim
  behavior, which already excludes preview/browser-plane secrets.
- Otherwise `403 user.permission_denied`.

Return `403` rather than silently dropping the `teams` field — a caller that
asked for expansion and got a user object without it cannot tell whether the
user has no teams or whether they were not allowed to see them.

Declare `team_membership.read` in the `security` block of `queryUsers` and
`listUserTeams` so the spec states the target contract even while the handler
runs the interim check.

### Where the check goes

- `POST /users/query`: only when `expand` includes `teams`. Unexpanded
  querying keeps requiring `user.read` alone.
- `GET /users/{user_id}/teams`: always.
- `member_of_team_id` **filtering** does not require it. Filtering by
  membership returns users, not roster rows — no membership data is disclosed
  beyond "this user is in the team you named", which the caller already named.
  Worth stating explicitly in the PR description; a reviewer will ask.

### List-level authz still applies

`maybeWriteAuthzListPredicate` constrains which *users* the caller sees. The
hydrate query inherits that set because it is keyed on already-authorized user
ids, so no second predicate is needed for membership rows. Team *names* come
along for the ride — confirm that is acceptable, or restrict the hydrate join
to readable teams.

---

## 4. Tests

- **`internal/storage/stmttest/`** — a `forEachDialect` suite is mandatory for
  new dialect statement behavior (`internal/storage/AGENTS.md:150`). Cover:
  roster hydration for a page of users, users with zero teams, the truncation
  cap boundary, removed memberships stay out, and expansion not perturbing the
  cursor (same page tokens with and without `IncludeTeams`).
- **`internal/service/user_test.go`** — filter/sort mapping including every
  rejection path; `member_of_team_id` rejected as a sort field; repeated
  `member_of_team_id` rejected; expansion reuses the roster status set.
- **`internal/api/user_internal_test.go`** — unknown `expand` value is `400`;
  `teams` absent when unrequested and `[]` when requested-but-empty; the roster
  gate returns `403` for a preview secret and passes for an operator secret.
- **Cross-check** the filter against the roster: a user returned for
  `member_of_team_id=X` must list X as `active` under `expand=teams`.
- **Cursor parity** — `POST /users/query` page tokens must round-trip against
  the same sorting, per the `page_token` contract in `query-teams-request.yaml`.

## 5. Docs

- **`docs/adrs/056-expanding-embedded-objects.md`** — new ADR recording the
  `expand` pattern itself (§8), plus its row in `docs/adrs/README.md`. Both
  ship **inside PR 5**, the PR that introduces expansion. No standalone docs
  PR: the ADR and the mechanism it describes land together or the ADR
  documents something that does not exist yet.
- `docs/design/api/resource-map.md:97` — replace the `GET /users` line with
  `POST /users/query`.
- `docs/design/api/system-permission-catalog.md:170` — `user.read` row becomes
  `POST /users/query`, `GET /users/{id}`, matching the `team.read` row's shape
  at line 155. Note that roster expansion additionally requires
  `team_membership.read`, and record the interim operator-secret behavior as
  drift with the other ADR 036 rows.
- `docs/adrs/024-user-team-lifecycle-ownership.md` — append a dated Amendment
  recording that the API now spells the two concepts `member_of_team_id` and
  `lifecycle_owner_team_id`. Do not edit the original decision text.
- `docs/adrs/027-cursor-based-pagination.md` — extend the existing amendment's
  list of implementing endpoints with `POST /users/query`.
- No ADR 031 amendment needed — this uses the query language as specified.

## 6. Sequencing — stacked PRs

Each branches off the previous, not off `main`.

| # | Branch | Contents |
|---|---|---|
| 1 | `users-team-param-rename` — **open, #980** | Split `team-id.yaml` into `initial-membership-team-id.yaml` + `member-of-team-id.yaml`; update `POST /users` and `GET /users/{user_id}` and the matching service/domain fields; ADR 024 amendment. Rename only, no behavior change. |
| 2 | `users-query-endpoint` | Add `POST /users/query` with `created_at` / `id` / `schema` / `status` / `lifecycle_owner_team_id`. No membership filter yet, `GET /users` still present. Spec, handler, service filter+sort mapping, tests, ADR 027 amendment. |
| 3 | `users-drop-get-list` | Remove `GET /users` and migrate all six consumers (§1). Touches Go, console, CLI, `api-mock`, `packages/testing` — no new behavior, so it reviews as a migration. |
| 4 | `users-query-membership-filter` | `member_of_team_id` filter field, `splitUserFilters`, service wiring. No storage work. |
| 5 | `users-expand-teams` | `expand=teams`, three dialect hydrates, `stmttest` suite, `requireRosterRead` gate, tightening `GET /users/{user_id}/teams`, ADR 056, catalog doc update. |

PR 1 is the smallest and unblocks the naming used by 2–5. PRs 2 and 3 are split
so the additive spec change is reviewable apart from the five-package
migration; 3 must not land before 2, or there is no way to list users. PR 5 is
the only one with storage work.

## 7. Decisions still open

1. **Filter active-only vs expansion full-roster** — confirm the asymmetry is
   wanted rather than adding a `membership_status` filter field now.
2. **Interim roster gate** — confirm that letting an operator project secret
   satisfy `team_membership.read` until #420 is acceptable, versus blocking
   expansion entirely until granular scopes ship.

Settled: truncation cap is **10** (§2).

## 8. ADR 056: expanding embedded objects

Drafted at `docs/adrs/056-expanding-embedded-objects.md`. It records the
pattern generally — opt-in `expand`, closed enum, absent-vs-empty, hard cap
with a truncation flag, hydrate-never-join, and a paginated sub-resource as the
escape hatch — so the next resource that wants an embedded child does not
re-litigate it.

It is committed on the planning branch only as a draft. Its real home is
**PR 5**: the ADR, the `expand` field, the dialect hydrates and the roster gate
are one reviewable unit. Reviewers judge the rule and the first use of it at
the same time, which is the only point at which the rule can still be argued
down cheaply.
