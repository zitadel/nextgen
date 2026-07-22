package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

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

// GetUserByID implements [service.UserStatements].
func (us userStatements) GetUserByID(ctx context.Context, projectID string, membershipTeamID *string, userID string, opts service.UserReadOptions) (*domain.User, error) {
	args := []any{projectID, userID}
	where := " WHERE zitadel_nextgen.users.project_id = $1 AND zitadel_nextgen.users.id = $2"
	if membershipTeamID != nil {
		args = append(args, *membershipTeamID, domain.MembershipStatusActive.String())
		where += fmt.Sprintf(
			` AND EXISTS (SELECT 1 FROM %s m WHERE m.project_id = zitadel_nextgen.users.project_id AND m.user_id = zitadel_nextgen.users.id AND m.team_id = $%d AND m.status = $%d)`,
			teamMembershipsTable, len(args)-1, len(args),
		)
	}

	attrKeys := opts.AttributeKeys
	if attrKeys == nil {
		attrKeys = []string{}
	}
	attrPh := "$" + strconv.Itoa(len(args)+1)
	authPh := "$" + strconv.Itoa(len(args)+2)
	args = append(args, attrKeys, opts.WithAuthMethods)

	stmt := strings.TrimSpace(fmt.Sprintf(`
SELECT zitadel_nextgen.users.project_id, zitadel_nextgen.users.schema_url, zitadel_nextgen.users.id, zitadel_nextgen.users.lifecycle_owner_team_id, zitadel_nextgen.users.status, zitadel_nextgen.users.created_at, zitadel_nextgen.users.updated_at,%s
FROM zitadel_nextgen.users%s`,
		userHydrationExpressions("zitadel_nextgen.users", attrPh, authPh),
		where,
	))

	rows, err := us.client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	user, err := pgx.CollectExactlyOneRow(rows, func(row pgx.CollectableRow) (*domain.User, error) {
		return scanUserHydrationRow(row, opts.WithAuthMethods)
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return user, nil
}

// GetUserByAttributes implements [service.UserStatements].
func (us userStatements) GetUserByAttributes(ctx context.Context, projectID string, attrs []domain.Attribute, opts service.UserReadOptions) (*domain.User, error) {
	result, err := us.ListUsersByAttributes(ctx, projectID, nil, attrs, opts)
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
func (us userStatements) ListUsers(ctx context.Context, filter *database.ListOptions[domain.UserField], offset uint32, opts service.UserReadOptions) (*database.ListResult[*domain.User], error) {
	if filter == nil {
		filter = &database.ListOptions[domain.UserField]{}
	}
	if len(filter.Pagination.OrderBy.Columns) == 0 {
		filter.Pagination.OrderBy = database.OrderBy[domain.UserField]{
			Columns: []database.Column[domain.UserField]{
				database.Col(domain.UserFieldCreatedAt),
				database.Col(domain.UserFieldID),
			},
			Direction: database.OrderAsc,
		}
	}

	var filterCompiler statementCompiler
	if filter.Filter != nil {
		filterCompiler.WriteString(" WHERE ")
		compileFilter(&filterCompiler, filter.Filter, userSchema)
	}
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
		var cursorFilter database.Filter[domain.UserField]
		if filter.Pagination.OrderBy.Direction == database.OrderAsc {
			cursorFilter = database.CompareGreater(terms...)
		} else {
			cursorFilter = database.CompareLess(terms...)
		}
		if filter.Filter != nil {
			filterCompiler.Reset()
			filterCompiler.WriteString(" WHERE ")
			compileFilter(&filterCompiler, database.And(filter.Filter, cursorFilter), userSchema)
		} else {
			filterCompiler.Reset()
			filterCompiler.WriteString(" WHERE ")
			compileFilter(&filterCompiler, cursorFilter, userSchema)
		}
	}

	args := append([]any(nil), filterCompiler.args...)
	attrKeys := opts.AttributeKeys
	if attrKeys == nil {
		attrKeys = []string{}
	}
	attrPh := "$" + strconv.Itoa(len(args)+1)
	authPh := "$" + strconv.Itoa(len(args)+2)
	args = append(args, attrKeys, opts.WithAuthMethods)

	stmt := strings.TrimSpace(fmt.Sprintf(`
SELECT zitadel_nextgen.users.project_id, zitadel_nextgen.users.schema_url, zitadel_nextgen.users.id, zitadel_nextgen.users.lifecycle_owner_team_id, zitadel_nextgen.users.status, zitadel_nextgen.users.created_at, zitadel_nextgen.users.updated_at,%s
FROM zitadel_nextgen.users%s`,
		userHydrationExpressions("zitadel_nextgen.users", attrPh, authPh),
		filterCompiler.String(),
	))

	var orderCompiler statementCompiler
	compileOrderBy(&orderCompiler, filter.Pagination.OrderBy, userSchema)
	stmt += orderCompiler.String()

	if filter.Pagination.Limit > 0 {
		args = append(args, filter.Pagination.Limit)
		stmt += " LIMIT $" + strconv.Itoa(len(args))
	}
	if offset > 0 {
		args = append(args, offset)
		stmt += " OFFSET $" + strconv.Itoa(len(args))
	}

	rows, err := us.client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	users, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*domain.User, error) {
		return scanUserHydrationRow(row, opts.WithAuthMethods)
	})
	if err != nil {
		return nil, wrapError(err)
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

// ListUsersByAttributes implements [service.UserStatements].
func (us userStatements) ListUsersByAttributes(ctx context.Context, projectID string, teamScope *string, attrs []domain.Attribute, opts service.UserReadOptions) (*database.ListResult[*domain.User], error) {
	if len(attrs) == 0 {
		return nil, fmt.Errorf("ListUsersByAttributes requires at least one attribute")
	}
	keys := make([]string, 0, len(attrs))
	jsonTexts := make([]string, 0, len(attrs))
	for _, a := range attrs {
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		keys = append(keys, a.Key)
		jsonTexts = append(jsonTexts, string(raw))
	}

	attrKeys := opts.AttributeKeys
	if attrKeys == nil {
		attrKeys = []string{}
	}
	attrPlaceholder := "$5"
	authPlaceholder := "$6"
	stmt := userListByAttributesCTE + fmt.Sprintf(`
SELECT u.project_id, u.schema_url, u.id, u.lifecycle_owner_team_id, u.status, u.created_at, u.updated_at,%s
FROM matching_ids m
JOIN zitadel_nextgen.users u ON u.project_id = $3 AND u.id = m.user_id`,
		userHydrationExpressions("u", attrPlaceholder, authPlaceholder),
	)
	args := []any{keys, jsonTexts, projectID, teamScope, attrKeys, opts.WithAuthMethods}

	rows, err := us.client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	users, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*domain.User, error) {
		return scanUserHydrationRow(row, opts.WithAuthMethods)
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return &database.ListResult[*domain.User]{Items: users}, nil
}

// DeactivateUser implements [service.UserStatements].
func (us userStatements) DeactivateUser(ctx context.Context, projectID, userID string) error {
	tag, err := us.client.Exec(ctx, deactivateUserStmt, domain.UserStatusDeactivated.String(), projectID, userID)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	_, err = us.client.Exec(ctx, deactivateUserMembershipsStmt, domain.MembershipStatusRemoved.String(), projectID, userID)
	return wrapError(err)
}

// DeleteUserByID implements [service.UserStatements].
func (us userStatements) DeleteUserByID(ctx context.Context, projectID, userID string) error {
	if _, err := us.client.Exec(ctx, deleteUserMembershipsStmt, projectID, userID); err != nil {
		return wrapError(err)
	}
	tag, err := us.client.Exec(ctx, deleteUserStmt, projectID, userID)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return wrapError(pgx.ErrNoRows)
	}
	return nil
}

func userHydrationExpressions(rowQualifier, attrKeysPlaceholder, authPlaceholder string) string {
	keyPred := "(cardinality(" + attrKeysPlaceholder + "::text[]) = 0 OR a.key = ANY (" + attrKeysPlaceholder + "::text[]))"
	subWhere := "a.project_id = " + rowQualifier + ".project_id AND a.user_id = " + rowQualifier + ".id AND " + keyPred
	return `
    (
      SELECT COALESCE(array_agg(s.k ORDER BY s.k), ARRAY[]::text[])
      FROM (
        SELECT a.key AS k
        FROM zitadel_nextgen.user_attributes a
        WHERE ` + subWhere + `
      ) s
    ) AS attr_keys,
    (
      SELECT COALESCE(array_agg(s.v ORDER BY s.k), ARRAY[]::jsonb[])
      FROM (
        SELECT a.key AS k, a.value AS v
        FROM zitadel_nextgen.user_attributes a
        WHERE ` + subWhere + `
      ) s
    ) AS attr_vals,
    CASE WHEN ` + authPlaceholder + ` THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_passwords p WHERE p.project_id = ` + rowQualifier + `.project_id AND p.user_id = ` + rowQualifier + `.id) ELSE FALSE END AS has_pw,
    CASE WHEN ` + authPlaceholder + ` THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_totp p WHERE p.project_id = ` + rowQualifier + `.project_id AND p.user_id = ` + rowQualifier + `.id) ELSE FALSE END AS has_totp,
    CASE WHEN ` + authPlaceholder + ` THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_recovery_codes p WHERE p.project_id = ` + rowQualifier + `.project_id AND p.user_id = ` + rowQualifier + `.id) ELSE FALSE END AS has_rc,
    CASE WHEN ` + authPlaceholder + ` THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_passkeys p WHERE p.project_id = ` + rowQualifier + `.project_id AND p.user_id = ` + rowQualifier + `.id) ELSE FALSE END AS has_pk`
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

type userAuthPresence struct {
	hasPassword bool
	hasTOTP     bool
	hasRC       bool
	hasPasskeys bool
}

func scanUserHydrationRow(row pgx.CollectableRow, withAuth bool) (*domain.User, error) {
	u := new(domain.User)
	var (
		lifecycleOwnerTeamID *string
		status               string
		attrKeys             []string
		attrVals             [][]byte
		flags                userAuthPresence
	)
	if err := row.Scan(
		&u.ProjectID,
		&u.SchemaURL,
		&u.ID,
		&lifecycleOwnerTeamID,
		&status,
		&u.CreatedAt,
		&u.UpdatedAt,
		&attrKeys,
		&attrVals,
		&flags.hasPassword,
		&flags.hasTOTP,
		&flags.hasRC,
		&flags.hasPasskeys,
	); err != nil {
		return nil, err
	}
	u.Status = domain.UserStatus(status)
	u.LifecycleOwnerTeamID = lifecycleOwnerTeamID

	if len(attrKeys) != len(attrVals) {
		return nil, fmt.Errorf("attribute key/value length mismatch: %d keys, %d values", len(attrKeys), len(attrVals))
	}
	for i, k := range attrKeys {
		var val any
		if err := json.Unmarshal(attrVals[i], &val); err != nil {
			return nil, fmt.Errorf("decode attribute value for %q: %w", k, err)
		}
		u.Attributes = append(u.Attributes, domain.Attribute{Key: k, Value: val})
	}
	if withAuth {
		u.AvailableAuthMethods = authMethodsFromFlags(flags)
	}
	return u, nil
}

func authMethodsFromFlags(f userAuthPresence) []domain.AuthMethod {
	out := make([]domain.AuthMethod, 0, 4)
	if f.hasPassword {
		out = append(out, domain.AuthMethodPassword)
	}
	if f.hasPasskeys {
		out = append(out, domain.AuthMethodPasskey)
	}
	if f.hasTOTP {
		out = append(out, domain.AuthMethodTOTP)
	}
	if f.hasRC {
		out = append(out, domain.AuthMethodRecoveryCodes)
	}
	return out
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
