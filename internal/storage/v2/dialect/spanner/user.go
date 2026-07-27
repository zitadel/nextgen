package spanner

import (
	"context"
	"encoding/json"
	"fmt"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	createUserHeaderStmt = `INSERT INTO users (project_id, schema_url, id, lifecycle_owner_team_id, status)
VALUES (@p1, @p2, @p3, @p4, @p5)`

	createUserAttributeStmt = `INSERT INTO user_attributes (project_id, team_id, user_id, key, value)
VALUES (@p1, @p2, @p3, @p4, PARSE_JSON(@p5))`

	createUserUniqueAttrStmt = `INSERT INTO user_unique_attributes (project_id, user_id, team_id, key, value_hash)
VALUES (@p1, @p2, @p3, @p4, @p5)`

	createUserMembershipStmt = `INSERT INTO team_memberships (project_id, team_id, user_id, status)
VALUES (@p1, @p2, @p3, @p4)`

	userAttributesTable = "user_attributes"

	userQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at FROM users`

	userAttributesByIDsQuery = `SELECT user_id, key, TO_JSON_STRING(value) FROM user_attributes
WHERE project_id = @p1 AND user_id IN UNNEST(@p2)`

	userAttributesByIDsAndKeysQuery = userAttributesByIDsQuery + `
AND key IN UNNEST(@p3)`

	deactivateUserStmt = `UPDATE users SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND id = @p3`

	deactivateUserMembershipsStmt = `UPDATE team_memberships SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND user_id = @p3 AND status <> @p1`

	deleteUserMembershipsStmt = `DELETE FROM team_memberships WHERE project_id = @p1 AND user_id = @p2`

	deleteUserStmt = `DELETE FROM users WHERE project_id = @p1 AND id = @p2`
)

type userStatements struct{ statement }

func newUserStatements(db queryExecutor) userStatements {
	return userStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateUser implements [service.UserStatements].
func (us userStatements) CreateUser(ctx context.Context, user *domain.CreateUser) error {
	if len(user.Attributes) == 0 {
		return fmt.Errorf("user create requires attributes")
	}
	teamScope := user.AttributeTeamScope()

	return withTransaction(ctx, us.db, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Update(ctx, buildStatement(createUserHeaderStmt,
			user.ProjectID, user.SchemaURL, user.ID, user.LifecycleOwnerTeamID, domain.UserStatusActive.String(),
		).statement()); err != nil {
			return err
		}

		for _, a := range user.Attributes {
			if a == nil {
				return fmt.Errorf("nil attribute")
			}
			raw, err := json.Marshal(a.Value)
			if err != nil {
				return fmt.Errorf("marshal attribute %q: %w", a.Key, err)
			}
			if _, err := tx.Update(ctx, buildStatement(createUserAttributeStmt,
				user.ProjectID, teamScope, user.ID, a.Key, string(raw),
			).statement()); err != nil {
				return err
			}
			if a.UniqueScope == domain.AttributeUniquenessUnspecified {
				continue
			}
			scopeTeamID := teamScope
			if a.UniqueScope == domain.AttributeUniquenessProject {
				scopeTeamID = ""
			}
			sum := a.ValueHash
			if _, err := tx.Update(ctx, buildStatement(createUserUniqueAttrStmt,
				user.ProjectID, user.ID, scopeTeamID, a.Key, append([]byte(nil), sum[:]...),
			).statement()); err != nil {
				return err
			}
		}

		if user.InitialMembershipTeamID != nil && *user.InitialMembershipTeamID != "" {
			if _, err := tx.Update(ctx, buildStatement(createUserMembershipStmt,
				user.ProjectID, *user.InitialMembershipTeamID, user.ID, domain.MembershipStatusActive.String(),
			).statement()); err != nil {
				return err
			}
		}
		return nil
	})
}

// GetUser implements [service.UserStatements].
func (us userStatements) GetUser(ctx context.Context, filter database.Filter[domain.UserField], opts service.UserQueryOptions) (*domain.User, error) {
	result, err := us.ListUsers(ctx, &database.ListOptions[domain.UserField]{Filter: filter}, opts)
	if err != nil {
		return nil, err
	}
	switch len(result.Items) {
	case 0:
		return nil, wrapError(spanner.ErrRowNotFound)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(errTooManyRows)
	}
}

// ListUsers implements [service.UserStatements].
func (us userStatements) ListUsers(ctx context.Context, filter *database.ListOptions[domain.UserField], opts service.UserQueryOptions) (*database.ListResult[*domain.User], error) {
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

	hasWhere := false
	if readFilter != nil {
		compiler.WriteString(" WHERE ")
		compileFilter(&compiler, readFilter, userSchema)
		hasWhere = true
	}
	for _, a := range opts.Attributes {
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		if hasWhere {
			compiler.WriteString(" AND ")
		} else {
			compiler.WriteString(" WHERE ")
			hasWhere = true
		}
		compiler.WriteString("EXISTS (SELECT 1 FROM ")
		compiler.WriteString(userAttributesTable)
		compiler.WriteString(" a WHERE a.project_id = users.project_id AND a.user_id = users.id AND a.key = ")
		compiler.WriteArg(a.Key)
		compiler.WriteString(" AND TO_JSON_STRING(a.value) = ")
		compiler.WriteArg(string(raw))
		compiler.WriteString(")")
	}
	if opts.MembershipTeamID != nil {
		if hasWhere {
			compiler.WriteString(" AND ")
		} else {
			compiler.WriteString(" WHERE ")
		}
		compiler.WriteString("EXISTS (SELECT 1 FROM ")
		compiler.WriteString(teamMembershipsTable)
		compiler.WriteString(" m WHERE m.project_id = users.project_id AND m.user_id = users.id AND m.team_id = ")
		compiler.WriteArg(*opts.MembershipTeamID)
		compiler.WriteString(" AND m.status = ")
		compiler.WriteArg(domain.MembershipStatusActive.String())
		compiler.WriteString(")")
	}

	compileOrderBy(&compiler, filter.Pagination.OrderBy, userSchema)
	compileLimit(&compiler, filter.Pagination.Limit)

	var headers []*domain.User
	err := us.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var qErr error
		headers, qErr = collectRows(iter, us.scanUserHeader)
		return qErr
	})
	if err != nil {
		return nil, err
	}
	if err := us.hydrateUsers(ctx, headers, opts); err != nil {
		return nil, err
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(headers) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.UserField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  userSchema.ValuesFrom(headers[len(headers)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}
	return &database.ListResult[*domain.User]{Items: headers, NextCursor: nextCursor}, nil
}

// DeactivateUser implements [service.UserStatements].
func (us userStatements) DeactivateUser(ctx context.Context, projectID, userID string) error {
	return withTransaction(ctx, us.db, func(ctx context.Context, tx queryExecutor) error {
		n, err := tx.Update(ctx, buildStatement(deactivateUserStmt,
			domain.UserStatusDeactivated.String(), projectID, userID,
		).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return wrapError(spanner.ErrRowNotFound)
		}
		_, err = tx.Update(ctx, buildStatement(deactivateUserMembershipsStmt,
			domain.MembershipStatusRemoved.String(), projectID, userID,
		).statement())
		return err
	})
}

// DeleteUserByID implements [service.UserStatements].
func (us userStatements) DeleteUserByID(ctx context.Context, projectID, userID string) error {
	return withTransaction(ctx, us.db, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Update(ctx, buildStatement(deleteUserMembershipsStmt, projectID, userID).statement()); err != nil {
			return err
		}
		n, err := tx.Update(ctx, buildStatement(deleteUserStmt, projectID, userID).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return wrapError(spanner.ErrRowNotFound)
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

	for projectID, projectUsers := range usersByProject {
		userIDs := make([]string, 0, len(projectUsers))
		usersByID := make(map[string]*domain.User, len(projectUsers))
		for _, user := range projectUsers {
			userIDs = append(userIDs, user.ID)
			usersByID[user.ID] = user
		}

		stmt := buildStatement(userAttributesByIDsQuery, projectID, userIDs).statement()
		if len(opts.AttributeKeys) > 0 {
			stmt = buildStatement(userAttributesByIDsAndKeysQuery, projectID, userIDs, opts.AttributeKeys).statement()
		}
		if err := us.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				var userID, key, valueJSON string
				if err := row.Columns(&userID, &key, &valueJSON); err != nil {
					return err
				}
				var val any
				if err := json.Unmarshal([]byte(valueJSON), &val); err != nil {
					return fmt.Errorf("decode attribute value for %q: %w", key, err)
				}
				user, ok := usersByID[userID]
				if !ok {
					return nil
				}
				user.Attributes = append(user.Attributes, domain.Attribute{Key: key, Value: val})
				return nil
			})
		}); err != nil {
			return err
		}
	}
	return nil
}

func (us userStatements) scanUserHeader(row *spanner.Row) (*domain.User, error) {
	user := new(domain.User)
	var (
		lifecycleOwner spanner.NullString
		status         string
	)
	if err := row.Columns(
		&user.ProjectID,
		&user.SchemaURL,
		&user.ID,
		&lifecycleOwner,
		&status,
		&user.CreatedAt,
		&user.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if lifecycleOwner.Valid {
		v := lifecycleOwner.StringVal
		user.LifecycleOwnerTeamID = &v
	}
	user.Status = domain.UserStatus(status)
	return user, nil
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
