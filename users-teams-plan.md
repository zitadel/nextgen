# Plan: team membership on `GET /users`

Two capabilities, one naming cleanup:

1. **Filter** users by team membership.
2. **Optionally expand** each user's team roster inline.
3. Make both unambiguously *not* `lifecycle_owner_team_id`.

---

## 0. The naming problem (do this first)

`team_id` is already a query parameter on two user endpoints, meaning two
different things:

| Endpoint | Meaning | Code |
|---|---|---|
| `POST /users?team_id=` | Sets the **lifecycle owner** team | `internal/api/user.go:17` → `CreateUserParams.TeamID` → `domain.User.LifecycleOwnerTeamID` |
| `GET /users/{user_id}?team_id=` | Requires an **active membership** | `internal/api/user.go:178` → `UserQueryOptions.MembershipTeamID` |

Both `$ref` the same `api/openapi/components/parameters/team-id.yaml`, described
only as "The unique identifier of the team". Adding a third `team_id` for list
filtering would compound this.

ADR 024 already draws the line, and `user-metadata.yaml` already states it well:
lifecycle ownership decides *who may deprovision the user*; the roster decides
*which teams the user collaborates in*.

**Decision:** split the shared parameter into two named ones and retire
`team-id.yaml` for user endpoints.

- `components/parameters/member-of-team-id.yaml` — name `member_of_team_id`.
  Used by `GET /users` (new) and `GET /users/{user_id}` (renamed from `team_id`).
- `components/parameters/lifecycle-owner-team-id.yaml` — name
  `lifecycle_owner_team_id`. Used by `POST /users` (renamed from `team_id`).

Each description states what it is *and* what it is not, pointing at ADR 024.

The app is pre-production, so both renames are straight substitutions with no
compatibility shim.

`team-id.yaml` is **kept**, not deleted: `POST /schemas`
(`endpoints/schemas/methods.yaml:18`) and `GET /schemas/{id}`
(`endpoints/schemas/by_id/methods.yaml:19`) also reference it, where `team_id`
is a schema-ownership scope — a third distinct meaning. Untangling that is out
of scope here; this plan only stops the *user* endpoints from adding to the
pile. Worth filing separately.

---

## 1. Filter: `GET /users?member_of_team_id=`

Storage already does this. `UserQueryOptions.MembershipTeamID` compiles an
`EXISTS` against `team_memberships` inside `ListUsers`, in all three dialects:

- `internal/storage/dialect/postgres/user.go:227`
- `internal/storage/dialect/sqlite/user.go:169`
- `internal/storage/dialect/spanner/user.go:177`

So this is pure exposure — no new SQL.

**Why a query parameter and not `POST /users/query`.** ADR 031 reserves the
structured `filter`/`sorting` body for the query endpoints and says `GET`
carries no filter/sort. This is not that language: it is the same
membership-scope parameter `GET /users/{user_id}` already carries, applied to
the collection. It stays a single-value scope, never grows operations or
combinators. The moment we need `member_of_team_id IN (...)`, status-aware
matching, or role predicates, that is the signal to open `POST /users/query`
under ADR 031 — not to grow this parameter.

### Changes

- **Spec** — `api/openapi/endpoints/users/methods.yaml`, `get.parameters`: add
  `member-of-team-id.yaml` alongside `limit` and `page-token`.
- **Handler** — `internal/api/user.go:64` `ListUsers`: lift `params.MemberOfTeamID`
  into `*string`, same shape as `GetUserByID` at line 178.
- **Service** — `internal/service/user.go:44` `ListUsersInput`: add
  `MemberOfTeamID *string`. Line 208 passes
  `UserQueryOptions{MembershipTeamID: input.MemberOfTeamID}` instead of `{}`.
- **Storage** — none.

### Status semantics

The membership `EXISTS` hardcodes `MembershipStatusActive`. Roster reads
(`ListUserTeams`, `internal/service/user.go:262`) use
`domain.RosterMembershipStatuses` — pending, active, inactive.

Keep the filter active-only: "which users are actually in this team" is an
access question, and it matches `GET /users/{user_id}?member_of_team_id=`
today. Say so in the parameter description — a pending invitee will not appear.
If callers need pending, that is `POST /users/query` with an explicit status
field, not a change here.

---

## 2. Expansion: `GET /users?expand=teams`

### Contract

- **Parameter** — `components/parameters/expand.yaml`, name `expand`,
  `in: query`, `style: form`, `explode: false`, array of a closed enum whose
  only member today is `teams`. Unknown value is `400 req.invalid`, never a
  silent ignore.
- **Response** — `user.yaml` gains an optional top-level `teams`, items
  `$ref` the existing `endpoints/users/by_id/teams/user-team.yaml`
  (`id`, `name`, `membership_status`, `created_at`, `updated_at`). Reusing that
  schema keeps the expanded shape and `GET /users/{user_id}/teams` identical.
- **Absent vs empty** — omit `teams` entirely when not requested; emit `[]` when
  requested and the user has no teams. The client can tell "not asked" from
  "none".
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
- `NextCursor` (`internal/storage/user/list.go:56`) marshals the keyset from the
  last row; row fan-out corrupts it, and pages start skipping or repeating.

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
- **`internal/domain/user.go`** — `User` gains a `Teams []UserTeam` field plus
  a truncation flag. `domain.UserTeam` already exists.
- **`internal/api/user.go:232`** `domainUserToApiUser` — emit `teams` only when
  populated. Check every caller: `CreateUser`, `GetUserByID`, `GetMyUser` all
  route through it and must keep omitting the field.

### Authorization — open question, needs a call

There is a live discrepancy between catalog and code:

- `docs/design/api/system-permission-catalog.md:193` assigns roster reads to
  `team_membership.read`, and line 155 states `team.read` does **not** imply
  `team_membership.*`.
- But `GET /users/{user_id}/teams` (`internal/api/user.go:138`) gates on
  `requireResourceAccess(..., userAccess, opRead)` — user read access only. No
  membership scope is checked.

Two consistent options:

1. **Match the shipped endpoint.** `expand=teams` needs nothing beyond the
   `user.read` that `GET /users` already requires. Consistent with
   `GET /users/{user_id}/teams`, zero new surface — and it means `user.read`
   discloses roster data, which the catalog says it should not.
2. **Match the catalog.** Require `team_membership.read` in addition, and
   return `403` when it is missing rather than silently dropping the field.
   Correct per the catalog, but leaves `GET /users/{user_id}/teams` as
   unfixed drift unless that endpoint is tightened in the same change.

Recommend option 2 including the `GET /users/{user_id}/teams` fix, so the two
roster surfaces agree and the catalog stops lying. Option 1 is defensible only
if the catalog row is what's wrong — that is a product call, not a code call.

Separately, the list-level authz predicate (`maybeWriteAuthzListPredicate`)
constrains which *users* the caller sees. The hydrate query inherits that set
because it is keyed on already-authorized user ids, so no second predicate is
needed for membership rows. Team *names* come along for the ride — confirm
that is acceptable, or restrict the hydrate join to readable teams.

---

## 3. Tests

- **`internal/storage/stmttest/`** — a `forEachDialect` suite is mandatory for
  new dialect statement behavior (`internal/storage/AGENTS.md:150`). Cover:
  roster hydration for a page of users, users with zero teams, the truncation
  cap boundary, removed memberships stay out, and expansion not perturbing the
  cursor (same page tokens with and without `IncludeTeams`).
- **`internal/service/user_test.go`** — `MemberOfTeamID` reaches
  `UserQueryOptions`; expansion reuses the roster status set.
- **`internal/api/user_internal_test.go`** — unknown `expand` value is `400`;
  `teams` absent when unrequested and `[]` when requested-but-empty; the authz
  gate from §2.
- **Cross-check** the filter against the roster: a user returned for
  `member_of_team_id=X` must list X as `active` under `expand=teams`.

## 4. Docs

- `docs/design/api/resource-map.md:97` — update the `GET /users` line with both
  parameters.
- `docs/design/api/system-permission-catalog.md:170` — `user.read` row, once §2
  is decided.
- `docs/adrs/024-user-team-lifecycle-ownership.md` — append a dated Amendment
  recording that the API now spells the two concepts `member_of_team_id` and
  `lifecycle_owner_team_id`. Do not edit the original decision text.
- No ADR 031 amendment needed — this does not touch the query language.

## 5. Sequencing

Three PRs, each shippable on its own:

1. **Parameter rename.** Split `team-id.yaml`, update `POST /users` and
   `GET /users/{user_id}`, ADR 024 amendment. Mechanical, no behavior change,
   lands the clarity fix before anything builds on it.
2. **Filter.** `member_of_team_id` on `GET /users`. Spec, handler, service
   input, tests. No storage work.
3. **Expansion.** `expand=teams` end to end, including the three dialect
   hydrates and the `stmttest` suite. The authz decision from §2 must be
   settled before this one starts.

## 6. Decisions needed

1. Authorization for roster expansion — option 1 or 2 in §2.
2. Truncation cap of 10 — confirm or set a number.
3. Filter stays active-only while expansion shows the full roster — confirm the
   asymmetry is wanted.
