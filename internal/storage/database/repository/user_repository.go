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

// UserRepository implements [domain.UserRepository] backed by project-scoped tables and user EAV.
type UserRepository struct {
	columnProjectID  database.Column
	columnID         database.Column
	columnTeamID     database.Column
	columnSchemaURL  database.Column
	columnCreatedAt  database.Column
	columnUpdatedAt  database.Column
	columnAttrKeyRef database.Column
}

func NewUserRepository() *UserRepository {
	return &UserRepository{
		columnProjectID:  database.NewColumn(userTable, "project_id"),
		columnID:         database.NewColumn(userTable, "id"),
		columnTeamID:     database.NewColumn(userTable, "team_id"),
		columnSchemaURL:  database.NewColumn(userTable, "schema_url"),
		columnCreatedAt:  database.NewColumn(userTable, "created_at"),
		columnUpdatedAt:  database.NewColumn(userTable, "updated_at"),
		columnAttrKeyRef: database.NewColumn(userAttributesTable, "key"),
	}
}

func (r *UserRepository) qualifiedTableName() string { return userTable }

func (r *UserRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.ID()}
}

func (r *UserRepository) UpdatedAtColumn() database.Column { return r.UpdatedAt() }

func (r *UserRepository) ProjectID() database.Column  { return r.columnProjectID }
func (r *UserRepository) ID() database.Column         { return r.columnID }
func (r *UserRepository) TeamID() database.Column     { return r.columnTeamID }
func (r *UserRepository) SchemaURL() database.Column  { return r.columnSchemaURL }
func (r *UserRepository) CreatedAt() database.Column  { return r.columnCreatedAt }
func (r *UserRepository) UpdatedAt() database.Column  { return r.columnUpdatedAt }
func (r *UserRepository) Attributes() database.Column { return r.columnAttrKeyRef }

func (r *UserRepository) PrimaryKeyCondition(projectID, id string) database.Condition {
	return database.And(r.ProjectIDCondition(projectID), r.IDCondition(id))
}

func (r *UserRepository) ProjectIDCondition(projectID string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, projectID)
}

func (r *UserRepository) IDCondition(id string) database.Condition {
	return database.NewTextCondition(r.ID(), database.TextOperationEqual, id)
}

func (r *UserRepository) TeamIDCondition(teamID string) database.Condition {
	return database.NewTextCondition(r.TeamID(), database.TextOperationEqual, teamID)
}

func (r *UserRepository) AttributesCondition(_ []domain.Attribute) database.Condition {
	return userLiteralAlwaysTrue{}
}

func (r *UserRepository) SetTeam(teamID *string) database.Change {
	return database.NewChangePtr(r.TeamID(), teamID)
}

func (r *UserRepository) SetAttribute(a domain.CreateAttribute) database.Change {
	return userUnsupportedChange{
		column: r.Attributes(),
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
	_, err := deleteOne(ctx, client, r, condition)
	return err
}

const userInsertSQL = `
WITH _input_data AS (
    SELECT *,
           unique_scope_txt::zitadel_nextgen.uniqueness_scope AS unique_scope
    FROM unnest(
        $5::text[],
        $6::jsonb[],
        $7::bytea[],
        $8::text[]
    ) AS t(key, value, value_hash, unique_scope_txt)
),
_user_header AS (
    INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, team_id)
    VALUES ($1, $2, $3, $4)
    RETURNING project_id, id, team_id
),
_registry AS (
    INSERT INTO zitadel_nextgen.user_unique_attributes (
        project_id, user_id, team_id, key, value_hash
    )
    SELECT h.project_id, h.id,
           CASE WHEN d.unique_scope = 'global'::zitadel_nextgen.uniqueness_scope
                THEN ''
                ELSE COALESCE(h.team_id, '')::text
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
    SELECT h.project_id, h.team_id, h.id, d.key, d.value
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

	_, err := client.Exec(ctx, userInsertSQL,
		user.ProjectID, user.SchemaURL, user.ID, user.TeamID,
		keys, values, hashes, scopes,
	)
	return err
}

func userHydrationExpressions(rowQualifier, attrPlaceholder, authPlaceholder string) string {
	return fmt.Sprintf(`
    (
      SELECT COALESCE(json_agg(json_build_object('key', a.key, 'value', to_jsonb(a.value))), '[]'::json)::text
        FROM zitadel_nextgen.user_attributes a
       WHERE a.project_id = %[1]s.project_id
         AND a.user_id = %[1]s.id
         AND (cardinality(%[2]s::text[]) = 0 OR a.key = ANY (%[2]s::text[]))
    ) AS attrs,
    CASE WHEN %[3]s THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_passwords p WHERE p.project_id = %[1]s.project_id AND p.user_id = %[1]s.id) ELSE FALSE END AS has_pw,
    CASE WHEN %[3]s THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_totp p WHERE p.project_id = %[1]s.project_id AND p.user_id = %[1]s.id) ELSE FALSE END AS has_totp,
    CASE WHEN %[3]s THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_recovery_codes p WHERE p.project_id = %[1]s.project_id AND p.user_id = %[1]s.id) ELSE FALSE END AS has_rc,
    CASE WHEN %[3]s THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_passkeys p WHERE p.project_id = %[1]s.project_id AND p.user_id = %[1]s.id) ELSE FALSE END AS has_pk,
    CASE WHEN %[3]s THEN EXISTS(SELECT 1 FROM zitadel_nextgen.user_pats p WHERE p.project_id = %[1]s.project_id AND p.user_id = %[1]s.id) ELSE FALSE END AS has_pat`,
		rowQualifier, attrPlaceholder, authPlaceholder)
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
SELECT zitadel_nextgen.users.project_id, zitadel_nextgen.users.schema_url, zitadel_nextgen.users.id, zitadel_nextgen.users.team_id, zitadel_nextgen.users.created_at, zitadel_nextgen.users.updated_at,%s
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
SELECT zitadel_nextgen.users.project_id, zitadel_nextgen.users.schema_url, zitadel_nextgen.users.id, zitadel_nextgen.users.team_id, zitadel_nextgen.users.created_at, zitadel_nextgen.users.updated_at,%s
FROM zitadel_nextgen.users%s`,
			userHydrationExpressions("zitadel_nextgen.users", attrPlaceholder, authPlaceholder),
			wherePart.String(),
		))
		args := slices.Clone(wherePart.Args())
		args = append(args, attrKeysAny, ext.WithAuthMethods)

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
SELECT u.project_id, u.schema_url, u.id, u.team_id, u.created_at, u.updated_at,%s
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
