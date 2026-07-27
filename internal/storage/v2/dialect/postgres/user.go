package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
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
)
SELECT 1;
`

	userInsertWithMembershipSQL = `
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
)
SELECT 1;
`

	userQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at FROM zitadel_nextgen.users`

	userListByAttributesCTE = `
WITH unique_filters AS (
    SELECT DISTINCT key, value_text
    FROM unnest($1::text[], $2::text[]) AS f(key, value_text)
),
matching_ids AS (
    SELECT p.user_id
    FROM unique_filters f
    JOIN zitadel_nextgen.user_attributes p
      ON p.project_id = $3
     AND p.key = f.key
     AND p.value = f.value_text::jsonb
    WHERE ($4::text IS NULL OR p.team_id IS NOT DISTINCT FROM $4::text)
      AND jsonb_typeof(p.value) IN ('string', 'number', 'boolean')
    GROUP BY p.user_id
    HAVING COUNT(*) = (SELECT COUNT(*) FROM unique_filters)
)
SELECT u.project_id, u.schema_url, u.id, u.lifecycle_owner_team_id, u.status, u.created_at, u.updated_at
FROM matching_ids m
JOIN zitadel_nextgen.users u ON u.project_id = $3 AND u.id = m.user_id
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
	if len(user.Attributes) == 0 {
		return fmt.Errorf("user create requires attributes")
	}
	keys := make([]string, len(user.Attributes))
	values := make([][]byte, len(user.Attributes))
	hashes := make([][]byte, len(user.Attributes))
	scopes := make([]string, len(user.Attributes))

	for i, a := range user.Attributes {
		if a == nil {
			return fmt.Errorf("nil attribute at index %d", i)
		}
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

	sql := userInsertSQL
	if user.InitialMembershipTeamID != nil && *user.InitialMembershipTeamID != "" {
		sql = userInsertWithMembershipSQL
		args = append(args, *user.InitialMembershipTeamID)
	}

	_, err := us.client.Exec(ctx, sql, args...)
	return wrapError(err)
}

// GetUser implements [service.UserStatements].
func (us userStatements) GetUser(ctx context.Context, filter database.Filter[domain.UserField], opts service.UserQueryOptions) (*domain.User, error) {
	result, err := us.ListUsers(ctx, &database.ListOptions[domain.UserField]{Filter: filter}, 0, opts)
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
func (us userStatements) ListUsers(ctx context.Context, filter *database.ListOptions[domain.UserField], offset uint32, opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
	if filter == nil {
		filter = &database.ListOptions[domain.UserField]{}
	}
	if len(opts.Attributes) > 0 {
		return us.listUsersByAttributes(ctx, filter, opts)
	}
	return us.listUsersByColumns(ctx, filter, offset, opts)
}

func (us userStatements) listUsersByColumns(ctx context.Context, filter *database.ListOptions[domain.UserField], offset uint32, opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
	if len(filter.Pagination.OrderBy.Columns) == 0 {
		filter.Pagination.OrderBy = database.OrderBy[domain.UserField]{
			Columns: []database.Column[domain.UserField]{
				database.Col(domain.UserFieldCreatedAt),
				database.Col(domain.UserFieldID),
			},
			Direction: database.OrderAsc,
		}
	}

	var compiler statementCompiler
	compiler.WriteString(userQuery)

	readFilter := filter.Filter
	if len(filter.Pagination.Cursor) != 0 {
		cursor, err := pagination.CursorFromToken[domain.UserField](filter.Pagination.Cursor)
		if err != nil {
			return nil, database.ErrInvalidCursor()
		}
		if !cursor.MatchesOrderBy(filter.Pagination.OrderBy.Columns) {
			return nil, database.ErrCursorOrderMismatch()
		}
		values, err := userSchema.CoerceCursorValues(cursor.Columns, cursor.Values)
		if err != nil {
			return nil, database.ErrInvalidCursor().WithParent(err)
		}
		terms := compareTerms(cursor.Columns, values)
		if filter.Pagination.OrderBy.Direction == database.OrderAsc {
			readFilter = database.And(readFilter, database.CompareGreater(terms...))
		} else {
			readFilter = database.And(readFilter, database.CompareLess(terms...))
		}
	}

	wroteWhere := false
	if readFilter != nil {
		compiler.WriteString(" WHERE ")
		compileFilter(&compiler, readFilter, userSchema)
		wroteWhere = true
	}
	if opts.MembershipTeamID != nil {
		if wroteWhere {
			compiler.WriteString(" AND ")
		} else {
			compiler.WriteString(" WHERE ")
		}
		compiler.WriteString("EXISTS (SELECT 1 FROM ")
		compiler.WriteString(teamMembershipsTable)
		compiler.WriteString(" m WHERE m.project_id = zitadel_nextgen.users.project_id AND m.user_id = zitadel_nextgen.users.id AND m.team_id = ")
		compiler.WriteArg(*opts.MembershipTeamID)
		compiler.WriteString(" AND m.status = ")
		compiler.WriteArg(domain.MembershipStatusActive.String())
		compiler.WriteString(")")
	}

	compileOrderBy(&compiler, filter.Pagination.OrderBy, userSchema)
	compileLimit(&compiler, filter.Pagination.Limit)
	if offset > 0 {
		compiler.WriteString(" OFFSET ")
		compiler.WriteArg(offset)
	}

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

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(users) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.UserField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  userSchema.ValuesFrom(users[len(users)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.User]{
		Items:      users,
		NextCursor: nextCursor,
	}, nil
}

func (us userStatements) listUsersByAttributes(ctx context.Context, filter *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
	projectID, ok := equalStringValue(filter.Filter, domain.UserFieldProjectID)
	if !ok {
		return nil, fmt.Errorf("ListUsers with Attributes requires an equal project_id filter")
	}

	keys := make([]string, 0, len(opts.Attributes))
	jsonTexts := make([]string, 0, len(opts.Attributes))
	for _, a := range opts.Attributes {
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		keys = append(keys, a.Key)
		jsonTexts = append(jsonTexts, string(raw))
	}

	rows, err := us.client.Query(ctx, userListByAttributesCTE, keys, jsonTexts, projectID, opts.AttributeTeamScope)
	if err != nil {
		return nil, wrapError(err)
	}
	users, err := pgx.CollectRows(rows, scanUserHeader)
	if err != nil {
		return nil, wrapError(err)
	}
	if opts.MembershipTeamID != nil {
		users, err = us.filterUsersByMembership(ctx, users, *opts.MembershipTeamID)
		if err != nil {
			return nil, err
		}
	}
	if err := us.hydrateUsers(ctx, users, opts); err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.User]{Items: users}, nil
}

func (us userStatements) filterUsersByMembership(ctx context.Context, users []*domain.User, teamID string) ([]*domain.User, error) {
	out := make([]*domain.User, 0, len(users))
	for _, user := range users {
		ok, err := us.hasActiveMembership(ctx, user.ProjectID, teamID, user.ID)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, user)
		}
	}
	return out, nil
}

func (us userStatements) hasActiveMembership(ctx context.Context, projectID, teamID, userID string) (bool, error) {
	var compiler statementCompiler
	compiler.WriteString("SELECT 1 FROM ")
	compiler.WriteString(teamMembershipsTable)
	compiler.WriteString(" WHERE project_id = ")
	compiler.WriteArg(projectID)
	compiler.WriteString(" AND team_id = ")
	compiler.WriteArg(teamID)
	compiler.WriteString(" AND user_id = ")
	compiler.WriteArg(userID)
	compiler.WriteString(" AND status = ")
	compiler.WriteArg(domain.MembershipStatusActive.String())
	compiler.WriteString(" LIMIT 1")

	rows, err := us.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return false, wrapError(err)
	}
	defer rows.Close()
	return rows.Next(), nil
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
		_, err = tx.Exec(ctx, deactivateUserMembershipsStmt, domain.MembershipStatusRemoved.String(), projectID, userID)
		return wrapError(err)
	})
}

// DeleteUserByID implements [service.UserStatements].
func (us userStatements) DeleteUserByID(ctx context.Context, projectID, userID string) error {
	return withTransaction(ctx, us.client, func(ctx context.Context, tx queryExecutor) error {
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

func (us userStatements) hydrateUsers(ctx context.Context, users []*domain.User, opts service.UserQueryOptions) error {
	if len(users) == 0 {
		return nil
	}

	usersByProject := make(map[string][]*domain.User)
	for _, user := range users {
		user.Attributes = nil
		usersByProject[user.ProjectID] = append(usersByProject[user.ProjectID], user)
	}

	attrKeys := opts.AttributeKeys
	if attrKeys == nil {
		attrKeys = []string{}
	}

	for projectID, projectUsers := range usersByProject {
		userIDs := make([]string, 0, len(projectUsers))
		usersByID := make(map[string]*domain.User, len(projectUsers))
		for _, user := range projectUsers {
			userIDs = append(userIDs, user.ID)
			usersByID[user.ID] = user
		}

		rows, err := us.client.Query(ctx, userAttributesByIDsQuery, projectID, userIDs, attrKeys)
		if err != nil {
			return wrapError(err)
		}
		_, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (struct{}, error) {
			var userID, key string
			var value []byte
			if err := row.Scan(&userID, &key, &value); err != nil {
				return struct{}{}, err
			}
			user, ok := usersByID[userID]
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
	return nil
}

func equalStringValue[F ~uint8](filter database.Filter[F], field F) (string, bool) {
	if filter == nil {
		return "", false
	}
	switch f := filter.(type) {
	case database.AndFilter[F]:
		for _, sub := range f.Filters {
			if v, ok := equalStringValue(sub, field); ok {
				return v, true
			}
		}
	case *database.CompareFilter[F]:
		if f.Op != database.OpEqual || len(f.Terms) != 1 {
			return "", false
		}
		if f.Terms[0].Column.Field() != field {
			return "", false
		}
		s, ok := f.Terms[0].Value.(string)
		return s, ok
	}
	return "", false
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
		&u.CreatedAt,
		&u.UpdatedAt,
	); err != nil {
		return nil, err
	}
	u.Status = domain.UserStatus(status)
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

func coerceUserStatus(v any) (any, error) {
	switch t := v.(type) {
	case domain.UserStatus:
		return t.String(), nil
	case string:
		return t, nil
	default:
		return nil, database.ErrCoerceExpectedType("user status", v)
	}
}

var _ service.UserStatements = (*userStatements)(nil)

var userSchema = database.NewSchema(map[domain.UserField]database.FieldBinding[domain.User]{
	domain.UserFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(u *domain.User) any { return u.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.UserFieldID: {
		SQLName:  "id",
		Accessor: func(u *domain.User) any { return u.ID },
		Coerce:   database.CoerceString,
	},
	domain.UserFieldSchemaURL: {
		SQLName:  "schema_url",
		Accessor: func(u *domain.User) any { return u.SchemaURL },
		Coerce:   database.CoerceString,
	},
	domain.UserFieldLifecycleOwnerTeamID: {
		SQLName: "lifecycle_owner_team_id",
		Accessor: func(u *domain.User) any {
			if u.LifecycleOwnerTeamID == nil {
				return ""
			}
			return *u.LifecycleOwnerTeamID
		},
		Coerce: database.CoerceString,
	},
	domain.UserFieldStatus: {
		SQLName:  "status",
		Accessor: func(u *domain.User) any { return u.Status.String() },
		Coerce:   coerceUserStatus,
	},
	domain.UserFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(u *domain.User) any { return u.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.UserFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(u *domain.User) any { return u.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
