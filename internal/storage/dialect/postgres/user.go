package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

const (
	teamMembershipsTable = "zitadel_nextgen.team_memberships"

	userInsertSQL = `
WITH _input_data AS (
    SELECT *,
           unique_scope_txt::zitadel_nextgen.uniqueness_scope AS unique_scope
    FROM unnest(
        $6::text[],
        $7::jsonb[],
        $8::bytea[],
        $9::text[]
    ) AS t(key, value, value_hash, unique_scope_txt)
),
_user_header AS (
    INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, lifecycle_owner_team_id, status)
    VALUES ($1, $2, $3, $4, 'active')
    RETURNING project_id, id
),
_registry AS (
    INSERT INTO zitadel_nextgen.user_unique_attributes (
        project_id, user_id, team_id, key, value_hash
    )
    SELECT h.project_id, h.id,
           CASE WHEN d.unique_scope = 'project'::zitadel_nextgen.uniqueness_scope
                THEN ''
                ELSE COALESCE($5::text, '')
           END,
           d.key, d.value_hash
    FROM _input_data d CROSS JOIN _user_header h
    WHERE d.unique_scope <> 'unspecified'::zitadel_nextgen.uniqueness_scope
      AND d.value_hash IS NOT NULL
),
_attributes AS (
    INSERT INTO zitadel_nextgen.user_attributes (
        project_id, team_id, user_id, key, value
    )
    SELECT h.project_id, COALESCE($5::text, ''), h.id, d.key, d.value
    FROM _input_data d CROSS JOIN _user_header h
),
_membership AS (
    INSERT INTO zitadel_nextgen.team_memberships (project_id, team_id, user_id, status)
    SELECT h.project_id, $10::text, h.id, 'active'
    FROM _user_header h
    WHERE $10::text IS NOT NULL AND $10::text <> ''
)
SELECT 1;
`

	userQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at FROM zitadel_nextgen.users`

	userAttributesTable       = "zitadel_nextgen.user_attributes"
	userUniqueAttributesTable = "zitadel_nextgen.user_unique_attributes"

	// userTeamsByIDsQuery hydrates the team memberships of one page of users
	// (ADR 059), ordered so each user's rows arrive together and by team name.
	//
	// The cap is applied in Go rather than by a per-user ROW_NUMBER window,
	// which would bound the read to cap+1 rows per user: the Spanner emulator
	// rejects analytic functions, and stmttest asserts all three dialects
	// behave alike, so the portable shape wins over the tighter one.
	userTeamsByIDsQuery = `
SELECT m.user_id, m.team_id, t.name, m.status, m.created_at, m.updated_at
FROM zitadel_nextgen.team_memberships m
JOIN zitadel_nextgen.teams t
  ON t.project_id = m.project_id AND t.id = m.team_id
WHERE m.project_id = $1
  AND m.user_id = ANY ($2::text[])
  AND m.status = ANY ($3::text[])
ORDER BY m.user_id, t.name, m.team_id
`

	// ownerTeamsByIDsQuery hydrates the lifecycle owner teams of one page of
	// users (ADR 059), keyed on the distinct owner ids the page returned.
	ownerTeamsByIDsQuery = `
SELECT id, name, status, created_at, updated_at
FROM zitadel_nextgen.teams
WHERE project_id = $1 AND id = ANY ($2::text[])
`

	userAttributesByIDsQuery = `
SELECT user_id, key, value
FROM zitadel_nextgen.user_attributes
WHERE project_id = $1
  AND user_id = ANY ($2::text[])
  AND (cardinality($3::text[]) = 0 OR key = ANY ($3::text[]))
`

	deactivateUserStmt = `
UPDATE zitadel_nextgen.users
SET status = $1, updated_at = NOW()
WHERE project_id = $2 AND id = $3
`

	deactivateUserMembershipsStmt = `
UPDATE zitadel_nextgen.team_memberships
SET status = $1, updated_at = NOW()
WHERE project_id = $2 AND user_id = $3 AND status <> $1
`

	deleteUserMembershipsStmt = `
DELETE FROM zitadel_nextgen.team_memberships
WHERE project_id = $1 AND user_id = $2
`

	deleteUserStmt = `
DELETE FROM zitadel_nextgen.users
WHERE project_id = $1 AND id = $2
`

	userExistsStmt = `
SELECT EXISTS (
    SELECT 1 FROM zitadel_nextgen.users
    WHERE project_id = $1 AND id = $2
)
`
)

type userStatements struct{ statement }

func newUserStatements(client queryExecutor) userStatements {
	return userStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateUser implements [service.UserStatements].
func (us userStatements) CreateUser(ctx context.Context, user *domain.CreateUser) error {
	if err := ensureManagedID(&user.ID, domain.PrefixUser); err != nil {
		return err
	}
	if len(user.Attributes) == 0 {
		return fmt.Errorf("user create requires attributes")
	}
	keys := make([]domain.AttributeKey, len(user.Attributes))
	values := make([][]byte, len(user.Attributes))
	hashes := make([][]byte, len(user.Attributes))
	scopes := make([]string, len(user.Attributes))

	for i, a := range user.Attributes {
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		keys[i] = a.Key
		values[i] = raw
		if a.UniqueScope == domain.AttributeUniquenessUnspecified {
			hashes[i] = nil
		} else {
			sum := a.ValueHash
			hashes[i] = append([]byte(nil), sum[:]...)
		}
		scopes[i] = uniquenessScopeLiteral(a.UniqueScope)
	}

	teamScope := user.AttributeTeamScope()
	args := []any{
		user.ProjectID, user.SchemaURL, user.ID, user.LifecycleOwnerTeamID,
		teamScope,
		keys, values, hashes, scopes,
	}

	initialTeamID := ""
	if user.InitialMembershipTeamID != nil {
		initialTeamID = *user.InitialMembershipTeamID
	}
	var membershipTeamID any
	if initialTeamID != "" {
		membershipTeamID = initialTeamID
	}
	args = append(args, membershipTeamID)

	return withTransaction(ctx, us.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, userInsertSQL, args...); err != nil {
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		edges := newAuthzMembershipEdgeStatements(tx)
		return authz.UserCreated(ctx, &rsi, &edges, user.ProjectID, user.ID, initialTeamID)
	})
}

// GetUser implements [service.UserStatements].
// By-id lookup is compileRead-shaped (#839): WithAuthzListUnrestricted skips
// the #838 tripwire and ignores an inherited list filter. HTTP ListUsers is
// the management path that must fail closed.
func (us userStatements) GetUser(ctx context.Context, filter database.Filter[domain.UserField], opts service.UserQueryOptions) (*domain.User, error) {
	result, err := us.ListUsers(service.WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.UserField]{Filter: filter}, opts)
	if err != nil {
		return nil, err
	}
	switch len(result.Items) {
	case 0:
		return nil, wrapError(pgx.ErrNoRows)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(pgx.ErrTooManyRows)
	}
}

// ListUsers implements [service.UserStatements].
func (us userStatements) ListUsers(ctx context.Context, filter *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
	if err := authz.RequireManagementListFilter(ctx); err != nil {
		return nil, err
	}
	filter = v2user.EnsureListOptions(filter)

	readFilter, err := v2user.ApplyCursor(filter.Filter, filter.Pagination)
	if err != nil {
		return nil, err
	}

	var compiler statementCompiler
	compiler.WriteString(userQuery)

	hasWhere := false
	if readFilter != nil {
		writeConjunct(&compiler, &hasWhere)
		compileFilter(&compiler, readFilter, v2user.Schema)
	}
	for _, a := range opts.Attributes {
		writeConjunct(&compiler, &hasWhere)
		if opts.UniqueAttributesOnly {
			hash, err := domain.UniqueValueHash(a.Value)
			if err != nil {
				return nil, fmt.Errorf("hash attribute %q: %w", a.Key, err)
			}
			compiler.WriteString("EXISTS (SELECT 1 FROM ")
			compiler.WriteString(userUniqueAttributesTable)
			compiler.WriteString(" ua WHERE ua.project_id = zitadel_nextgen.users.project_id AND ua.user_id = zitadel_nextgen.users.id AND ua.key = ")
			compiler.WriteArg(a.Key)
			compiler.WriteString(" AND ua.value_hash = ")
			compiler.WriteArg(hash[:])
			compiler.WriteString(")")
			continue
		}
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		compiler.WriteString("EXISTS (SELECT 1 FROM ")
		compiler.WriteString(userAttributesTable)
		compiler.WriteString(" a WHERE a.project_id = zitadel_nextgen.users.project_id AND a.user_id = zitadel_nextgen.users.id AND a.key = ")
		compiler.WriteArg(a.Key)
		compiler.WriteString(" AND a.value = ")
		compiler.WriteArg(string(raw))
		compiler.WriteString("::jsonb AND jsonb_typeof(a.value) IN ('string', 'number', 'boolean'))")
	}
	if opts.MembershipTeamID != nil {
		writeConjunct(&compiler, &hasWhere)
		compiler.WriteString("EXISTS (SELECT 1 FROM ")
		compiler.WriteString(teamMembershipsTable)
		compiler.WriteString(" m WHERE m.project_id = zitadel_nextgen.users.project_id AND m.user_id = zitadel_nextgen.users.id AND m.team_id = ")
		compiler.WriteArg(*opts.MembershipTeamID)
		compiler.WriteString(" AND m.status = ")
		compiler.WriteArg(domain.MembershipStatusActive.String())
		compiler.WriteString(")")
	}
	maybeWriteAuthzListPredicate(ctx, &compiler, &hasWhere, "zitadel_nextgen.users", "id")

	compileOrderBy(&compiler, filter.Pagination.OrderBy, v2user.Schema)
	compileLimit(&compiler, filter.Pagination.Limit)

	rows, err := us.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	users, err := pgx.CollectRows(rows, scanUserHeader)
	if err != nil {
		return nil, wrapError(err)
	}
	if err := us.hydrateUsers(ctx, users, opts); err != nil {
		return nil, err
	}

	return &database.ListResult[*domain.User]{
		Items:      users,
		NextCursor: v2user.NextCursor(users, filter.Pagination),
	}, nil
}

func writeConjunct(c *statementCompiler, hasWhere *bool) {
	if *hasWhere {
		c.WriteString(" AND ")
		return
	}
	c.WriteString(" WHERE ")
	*hasWhere = true
}

// DeactivateUser implements [service.UserStatements].
func (us userStatements) DeactivateUser(ctx context.Context, projectID, userID string) error {
	return withTransaction(ctx, us.client, func(ctx context.Context, tx queryExecutor) error {
		tag, err := tx.Exec(ctx, deactivateUserStmt, domain.UserStatusDeactivated.String(), projectID, userID)
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() == 0 {
			return wrapError(pgx.ErrNoRows)
		}
		if _, err = tx.Exec(ctx, deactivateUserMembershipsStmt, domain.MembershipStatusRemoved.String(), projectID, userID); err != nil {
			return wrapError(err)
		}
		edges := newAuthzMembershipEdgeStatements(tx)
		return authz.UserDeactivated(ctx, &edges, projectID, userID)
	})
}

// DeleteUserByID implements [service.UserStatements].
func (us userStatements) DeleteUserByID(ctx context.Context, projectID, userID string) error {
	return withTransaction(ctx, us.client, func(ctx context.Context, tx queryExecutor) error {
		rsi := newResourceScopeStatements(tx)
		edges := newAuthzMembershipEdgeStatements(tx)
		if err := authz.UserDeleted(ctx, &rsi, &edges, projectID, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, deleteUserMembershipsStmt, projectID, userID); err != nil {
			return wrapError(err)
		}
		tag, err := tx.Exec(ctx, deleteUserStmt, projectID, userID)
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() == 0 {
			return wrapError(pgx.ErrNoRows)
		}
		return nil
	})
}

func (us userStatements) UserExists(ctx context.Context, projectID, userID string) (bool, error) {
	rows, err := us.client.Query(ctx, userExistsStmt, projectID, userID)
	if err != nil {
		return false, wrapError(err)
	}
	exists, err := pgx.CollectExactlyOneRow(rows, pgx.RowTo[bool])
	if err != nil {
		return false, wrapError(err)
	}
	return exists, nil
}

func (us userStatements) hydrateUsers(ctx context.Context, users []*domain.User, opts service.UserQueryOptions) error {
	if len(users) == 0 {
		return nil
	}

	attrKeys := opts.AttributeKeys
	if attrKeys == nil {
		attrKeys = []string{}
	}

	// Grouped once and reused: GroupByProject clears Attributes, so a second
	// pass would wipe the ones this call just hydrated.
	groups := v2user.GroupByProject(users)

	for _, group := range groups {
		rows, err := us.client.Query(ctx, userAttributesByIDsQuery, group.ProjectID, group.IDs, attrKeys)
		if err != nil {
			return wrapError(err)
		}
		_, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (struct{}, error) {
			var userID string
			var key domain.AttributeKey
			var value []byte
			if err := row.Scan(&userID, &key, &value); err != nil {
				return struct{}{}, err
			}
			user, ok := group.ByID[userID]
			if !ok {
				return struct{}{}, nil
			}
			var val any
			if err := json.Unmarshal(value, &val); err != nil {
				return struct{}{}, fmt.Errorf("decode attribute value for %q: %w", key, err)
			}
			user.Attributes = append(user.Attributes, domain.Attribute{Key: key, Value: val})
			return struct{}{}, nil
		})
		if err != nil {
			return wrapError(err)
		}
	}

	if opts.IncludeTeams {
		if err := us.hydrateUserTeams(ctx, groups, opts); err != nil {
			return err
		}
	}
	if opts.IncludeLifecycleOwnerTeam {
		return us.hydrateUserOwnerTeams(ctx, groups)
	}
	return nil
}

// hydrateUserTeams loads the team memberships of an already-read page of users
// (ADR 059): one batched query per project group, keyed on the ids the page already
// returned. Joining memberships into the user query instead would multiply rows
// — LIMIT would count memberships rather than users, and the keyset cursor is
// marshalled from the last row's sort values, so fan-out corrupts it.
func (us userStatements) hydrateUserTeams(ctx context.Context, groups []v2user.ProjectGroup, opts service.UserQueryOptions) error {
	limit := opts.TeamsLimit
	if limit <= 0 {
		limit = service.DefaultUserTeamsLimit
	}

	for _, group := range groups {
		collector := v2user.NewTeamCollector(group, limit)
		rows, err := us.client.Query(ctx, userTeamsByIDsQuery, group.ProjectID, group.IDs, v2user.MembershipStatusStrings())
		if err != nil {
			return wrapError(err)
		}
		_, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (struct{}, error) {
			var (
				userID string
				team   domain.UserTeam
				status string
			)
			if err := row.Scan(&userID, &team.TeamID, &team.TeamName, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
				return struct{}{}, err
			}
			team.ProjectID = group.ProjectID
			team.UserID = userID
			team.Status = domain.MembershipStatus(status)
			collector.Add(userID, team)
			return struct{}{}, nil
		})
		if err != nil {
			return wrapError(err)
		}
	}
	return nil
}

// hydrateUserOwnerTeams loads the lifecycle owner teams of an already-read page
// of users (ADR 059), keyed on the distinct owner ids the page returned. A
// group of self-owned users runs no query at all.
func (us userStatements) hydrateUserOwnerTeams(ctx context.Context, groups []v2user.ProjectGroup) error {
	for _, group := range groups {
		collector := v2user.NewOwnerTeamCollector(group)
		teamIDs := collector.TeamIDs()
		if len(teamIDs) == 0 {
			continue
		}

		rows, err := us.client.Query(ctx, ownerTeamsByIDsQuery, group.ProjectID, teamIDs)
		if err != nil {
			return wrapError(err)
		}
		_, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (struct{}, error) {
			var (
				team   domain.Team
				status string
			)
			if err := row.Scan(&team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
				return struct{}{}, err
			}
			team.ProjectID = group.ProjectID
			team.Status = domain.TeamStatus(status)
			collector.Add(team)
			return struct{}{}, nil
		})
		if err != nil {
			return wrapError(err)
		}
	}
	return nil
}

func scanUserHeader(row pgx.CollectableRow) (*domain.User, error) {
	u := new(domain.User)
	var (
		lifecycleOwnerTeamID *string
		status               string
	)
	if err := row.Scan(
		&u.ProjectID,
		&u.SchemaURL,
		&u.ID,
		&lifecycleOwnerTeamID,
		&status,
		&u.Metadata.CreatedAt,
		&u.Metadata.UpdatedAt,
	); err != nil {
		return nil, err
	}
	u.Metadata.Status = domain.UserStatus(status)
	u.LifecycleOwnerTeamID = lifecycleOwnerTeamID
	return u, nil
}

func uniquenessScopeLiteral(scope domain.AttributeUniqueness) string {
	switch scope {
	case domain.AttributeUniquenessUnspecified:
		return "unspecified"
	case domain.AttributeUniquenessTeam:
		return "team"
	case domain.AttributeUniquenessProject:
		return "project"
	default:
		return "unspecified"
	}
}

var _ service.UserStatements = (*userStatements)(nil)
