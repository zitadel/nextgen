package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	userTable           = "zitadel_nextgen.users"
	userAttributesTable = "zitadel_nextgen.user_attributes"
)

var (
	colUserProjectID            = database.NewColumn(userTable, "project_id")
	colUserID                   = database.NewColumn(userTable, "id")
	colUserLifecycleOwnerTeamID = database.NewColumn(userTable, "lifecycle_owner_team_id")
	colUserStatus               = database.NewColumn(userTable, "status")
	colUserSchemaURL            = database.NewColumn(userTable, "schema_url")
	colUserCreatedAt            = database.NewColumn(userTable, "created_at")
	colUserUpdatedAt            = database.NewColumn(userTable, "updated_at")
	colUserAttributeProjectID   = database.NewColumn(userAttributesTable, "project_id")
	colUserAttributeTeamID      = database.NewColumn(userAttributesTable, "team_id")
	colUserAttributeUserID      = database.NewColumn(userAttributesTable, "user_id")
	colUserAttributeKey         = database.NewColumn(userAttributesTable, "key")
	colUserAttributeValue       = database.NewColumn(userAttributesTable, "value")
)

// UserRepository implements [domain.UserRepository] backed by project-scoped tables and user EAV.
type UserRepository struct{}

func NewUserRepository() *UserRepository {
	// TODO: add spanner integration
	return &UserRepository{}
}

func (r *UserRepository) qualifiedTableName() string { return userTable }

func (r *UserRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{colUserProjectID, colUserID}
}

func (r *UserRepository) UpdatedAtColumn() database.Column { return colUserUpdatedAt }

func (r *UserRepository) PrimaryKeyCondition(projectID, id string) database.Condition {
	return database.And(r.ProjectIDCondition(projectID), r.IDCondition(id))
}

func (r *UserRepository) ProjectIDCondition(projectID string) database.Condition {
	return database.NewTextCondition(colUserProjectID, database.TextOperationEqual, projectID)
}

func (r *UserRepository) IDCondition(id string) database.Condition {
	return database.NewTextCondition(colUserID, database.TextOperationEqual, id)
}

func (r *UserRepository) LifecycleOwnerTeamIDCondition(teamID string) database.Condition {
	return database.NewTextCondition(colUserLifecycleOwnerTeamID, database.TextOperationEqual, teamID)
}

type membershipTeamMatch struct{ teamID string }

func (c membershipTeamMatch) Write(b *database.StatementBuilder) {
	b.WriteString("EXISTS (SELECT 1 FROM zitadel_nextgen.team_memberships m WHERE m.project_id = ")
	colUserProjectID.WriteQualified(b)
	b.WriteString(" AND m.user_id = ")
	colUserID.WriteQualified(b)
	b.WriteString(" AND m.team_id = ")
	b.WriteArg(c.teamID)
	b.WriteString(" AND m.status = 'active')")
}

func (c membershipTeamMatch) Matches(x any) bool {
	other, ok := x.(membershipTeamMatch)
	return ok && c.teamID == other.teamID
}

func (membershipTeamMatch) String() string { return "membershipTeamMatch" }

func (membershipTeamMatch) IsRestrictingColumn(database.Column) bool { return false }

var _ database.Condition = membershipTeamMatch{}

func (r *UserRepository) MembershipTeamCondition(teamID string) database.Condition {
	return membershipTeamMatch{teamID: teamID}
}

func (r *UserRepository) AttributesCondition(attrs []domain.Attribute) database.Condition {
	if len(attrs) == 0 {
		return userLiteralAlwaysTrue{}
	}
	conds := make([]database.Condition, 0, len(attrs))
	for _, a := range attrs {
		conds = append(conds, database.Exists(userAttributesTable, userAttributeMatch{key: a.Key, value: a.Value}))
	}
	return database.And(conds...)
}

func (r *UserRepository) SetLifecycleOwnerTeamID(teamID *string) database.Change {
	return database.NewChangePtr(colUserLifecycleOwnerTeamID, teamID)
}

func (r *UserRepository) SetStatus(status domain.UserStatus) database.Change {
	return database.NewChange(colUserStatus, status.String())
}

func (r *UserRepository) SetAttribute(a domain.CreateAttribute) database.Change {
	return userUnsupportedChange{
		column: colUserAttributeKey,
		err:    fmt.Errorf("SetAttribute(%q) is not supported; use dedicated PUT/PATCH EAV sync SQL", a.Key),
	}
}

func (r *UserRepository) DeleteAttribute(string) database.Condition { return userLiteralAlwaysTrue{} }

func (r *UserRepository) WithAttributes(keys ...string) database.QueryOption {
	return mergeUserQueryExtra(func(e *UserQueryExtra) {
		if len(keys) > 0 {
			e.AttributeKeys = slices.Clone(keys)
		}
	})
}

func (r *UserRepository) WithAvailableAuthMethods() database.QueryOption {
	return mergeUserQueryExtra(func(e *UserQueryExtra) { e.WithAuthMethods = true })
}

func mergeUserQueryExtra(mut func(*UserQueryExtra)) database.QueryOption {
	return func(opts *database.QueryOpts) {
		ext, ok := opts.Extra.(*UserQueryExtra)
		if !ok || ext == nil {
			ext = &UserQueryExtra{}
			opts.Extra = ext
		}
		mut(ext)
	}
}

// WithUserScalarList configures static intersecting scans on scalar EAV rows scoped to ListProject/ListTeamScope.
func WithUserScalarList(project string, filters []UserListScalarFilter, teamScope *string) database.QueryOption {
	return mergeUserQueryExtra(func(e *UserQueryExtra) {
		e.ListProject = project
		e.ListTeamScope = teamScope
		e.ListScalarFilters = slices.Clone(filters)
	})
}

func (r *UserRepository) Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error {
	if err := checkPKOrUniqueKeyCondition(r, condition); err != nil {
		return err
	}
	return withTransaction(ctx, client, func(ctx context.Context, tx database.QueryExecutor) error {
		builder := database.NewStatementBuilder(
			"DELETE FROM zitadel_nextgen.team_memberships WHERE (project_id, user_id) IN (SELECT project_id, id FROM ",
		)
		builder.WriteString(userTable)
		builder.WriteString(" WHERE ")
		condition.Write(builder)
		builder.WriteString(")")
		if _, err := tx.Exec(ctx, builder.String(), builder.Args()...); err != nil {
			return err
		}
		_, err := deleteOne(ctx, tx, r, condition)
		return err
	})
}

const userInsertSQL = `
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

func (r *UserRepository) Create(ctx context.Context, client database.QueryExecutor, user *domain.CreateUser) error {
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

	// Dialect selection for membership repo uses the outer client: nested Begin
	// returns a savepoint that may not implement the dialect pooler marker.
	var membershipRepo *TeamMembershipRepository
	if user.InitialMembershipTeamID != nil && *user.InitialMembershipTeamID != "" {
		membershipRepo = NewTeamMembershipRepository(client)
	}

	return withTransaction(ctx, client, func(ctx context.Context, tx database.QueryExecutor) error {
		if _, err := tx.Exec(ctx, userInsertSQL,
			user.ProjectID, user.SchemaURL, user.ID, user.LifecycleOwnerTeamID,
			user.AttributeTeamScope(),
			keys, values, hashes, scopes,
		); err != nil {
			return err
		}
		if membershipRepo == nil {
			return nil
		}
		return membershipRepo.Create(ctx, tx, &domain.TeamMembership{
			ProjectID: user.ProjectID,
			TeamID:    *user.InitialMembershipTeamID,
			UserID:    user.ID,
			Status:    domain.MembershipStatusActive,
		})
	})
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

func (r *UserRepository) Deactivate(ctx context.Context, client database.QueryExecutor, projectID, userID string) error {
	cond := r.PrimaryKeyCondition(projectID, userID)
	_, err := updateOne(ctx, client, r, cond,
		r.SetStatus(domain.UserStatusDeactivated),
		database.NewChange(colUserUpdatedAt, database.NowInstruction),
	)
	if err != nil {
		return err
	}
	_, err = client.Exec(ctx,
		`UPDATE zitadel_nextgen.team_memberships SET status = $3, updated_at = NOW()`+
			` WHERE project_id = $1 AND user_id = $2 AND status <> $3`,
		projectID, userID, domain.MembershipStatusRemoved.String(),
	)
	return err
}

func (r *UserRepository) GetByID(ctx context.Context, client database.QueryExecutor, projectID string, membershipTeamID *string, userID string) (*domain.User, error) {
	condition := r.PrimaryKeyCondition(projectID, userID)
	if membershipTeamID != nil {
		condition = database.And(condition, r.MembershipTeamCondition(*membershipTeamID))
	}
	return r.Get(ctx, client, database.WithCondition(condition))
}

func (r *UserRepository) Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.User, error) {
	queryOpts := &database.QueryOpts{}
	for _, o := range opts {
		o(queryOpts)
	}
	if queryOpts.Condition == nil {
		return nil, fmt.Errorf("Get requires Condition")
	}
	var ext UserQueryExtra
	if u, ok := queryOpts.Extra.(*UserQueryExtra); ok && u != nil {
		ext = *u
	}
	wherePart := database.NewStatementBuilder(" WHERE ")
	queryOpts.Condition.Write(wherePart)

	n := len(wherePart.Args())
	attrPlaceholder := "$" + strconv.Itoa(n+1)
	authPlaceholder := "$" + strconv.Itoa(n+2)

	stmt := strings.TrimSpace(fmt.Sprintf(`
SELECT zitadel_nextgen.users.project_id, zitadel_nextgen.users.schema_url, zitadel_nextgen.users.id, zitadel_nextgen.users.lifecycle_owner_team_id, zitadel_nextgen.users.status, zitadel_nextgen.users.created_at, zitadel_nextgen.users.updated_at,%s
FROM zitadel_nextgen.users%s`,
		userHydrationExpressions("zitadel_nextgen.users", attrPlaceholder, authPlaceholder),
		wherePart.String(),
	))
	args := slices.Clone(wherePart.Args())
	attrKeysAny := ext.AttributeKeys
	if attrKeysAny == nil {
		attrKeysAny = []string{}
	}
	args = append(args, attrKeysAny, ext.WithAuthMethods)

	rows, err := client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, coerceNoRows(rows.Err())
	}
	u, flags, err := scanUserHydrationRowParts(rows)
	if err != nil {
		return nil, err
	}
	if rows.Next() {
		return nil, fmt.Errorf("expected single row for Get")
	}
	return applyAuthMethods(u, ext.WithAuthMethods, flags), rows.Err()
}

const userListByAttributesCTE = `
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

func (r *UserRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.User, error) {
	queryOpts := &database.QueryOpts{}
	for _, o := range opts {
		o(queryOpts)
	}
	var ext UserQueryExtra
	if u, ok := queryOpts.Extra.(*UserQueryExtra); ok && u != nil {
		ext = *u
	}
	if queryOpts.Condition == nil && len(ext.ListScalarFilters) == 0 {
		return nil, fmt.Errorf("List requires Condition and/or scalar list filters via WithUserScalarList")
	}

	attrKeysAny := ext.AttributeKeys
	if attrKeysAny == nil {
		attrKeysAny = []string{}
	}

	if len(ext.ListScalarFilters) == 0 {
		if queryOpts.Condition == nil {
			return nil, fmt.Errorf("List requires Condition without scalar filters")
		}
		wherePart := database.NewStatementBuilder(" WHERE ")
		queryOpts.Condition.Write(wherePart)
		n := len(wherePart.Args())
		attrPlaceholder := "$" + strconv.Itoa(n+1)
		authPlaceholder := "$" + strconv.Itoa(n+2)
		stmt := strings.TrimSpace(fmt.Sprintf(`
SELECT zitadel_nextgen.users.project_id, zitadel_nextgen.users.schema_url, zitadel_nextgen.users.id, zitadel_nextgen.users.lifecycle_owner_team_id, zitadel_nextgen.users.status, zitadel_nextgen.users.created_at, zitadel_nextgen.users.updated_at,%s
FROM zitadel_nextgen.users%s`,
			userHydrationExpressions("zitadel_nextgen.users", attrPlaceholder, authPlaceholder),
			wherePart.String(),
		))
		args := slices.Clone(wherePart.Args())
		args = append(args, attrKeysAny, ext.WithAuthMethods)

		// Honor WithLimit/WithOffset (GET /users pagination). The order is
		// pinned — a window over an unordered scan would be meaningless.
		stmt += "\nORDER BY zitadel_nextgen.users.created_at, zitadel_nextgen.users.id"
		if queryOpts.Limit > 0 {
			args = append(args, queryOpts.Limit)
			stmt += " LIMIT $" + strconv.Itoa(len(args))
		}
		if queryOpts.Offset > 0 {
			args = append(args, queryOpts.Offset)
			stmt += " OFFSET $" + strconv.Itoa(len(args))
		}

		return collectUserRows(ctx, client, stmt, args, ext.WithAuthMethods)
	}

	if strings.TrimSpace(ext.ListProject) == "" {
		return nil, fmt.Errorf("List with scalar filters requires ListProject via WithUserScalarList")
	}
	keys := make([]string, 0, len(ext.ListScalarFilters))
	jsonTexts := make([]string, 0, len(ext.ListScalarFilters))
	for _, f := range ext.ListScalarFilters {
		keys = append(keys, f.Key)
		jsonTexts = append(jsonTexts, string(f.Value))
	}
	attrPlaceholder := "$5"
	authPlaceholder := "$6"

	stmt := strings.TrimSpace(fmt.Sprintf(`%s
SELECT u.project_id, u.schema_url, u.id, u.lifecycle_owner_team_id, u.status, u.created_at, u.updated_at,%s
FROM matching_ids m
JOIN zitadel_nextgen.users u ON u.project_id = $3 AND u.id = m.user_id`,
		userListByAttributesCTE,
		userHydrationExpressions("u", attrPlaceholder, authPlaceholder),
	))
	args := []any{
		keys,
		jsonTexts,
		ext.ListProject,
		ext.ListTeamScope,
		attrKeysAny,
		ext.WithAuthMethods,
	}
	return collectUserRows(ctx, client, stmt, args, ext.WithAuthMethods)
}

func collectUserRows(ctx context.Context, client database.QueryExecutor, stmt string, args []any, withAuth bool) ([]*domain.User, error) {
	rows, err := client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*domain.User, 0)
	for rows.Next() {
		u, flags, err := scanUserHydrationRowParts(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, applyAuthMethods(u, withAuth, flags))
	}
	return out, rows.Err()
}

var _ domain.UserRepository = (*UserRepository)(nil)
