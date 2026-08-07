package spanner

import (
	"context"
	"encoding/json"
	"fmt"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/authz"
	v2user "github.com/zitadel/nextgen/internal/storage/v2/user"
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

	userExistsStmt = `SELECT EXISTS (
    SELECT 1 FROM users WHERE project_id = @p1 AND id = @p2
)`
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
	if err := ensureManagedID(&user.ID, domain.PrefixUser); err != nil {
		return err
	}
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

		initialTeamID := ""
		if user.InitialMembershipTeamID != nil {
			initialTeamID = *user.InitialMembershipTeamID
		}
		if initialTeamID != "" {
			if _, err := tx.Update(ctx, buildStatement(createUserMembershipStmt,
				user.ProjectID, initialTeamID, user.ID, domain.MembershipStatusActive.String(),
			).statement()); err != nil {
				return err
			}
		}
		rsi := newResourceScopeStatements(tx)
		edges := newAuthzMembershipEdgeStatements(tx)
		return authz.UserCreated(ctx, &rsi, &edges, user.ProjectID, user.ID, initialTeamID)
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
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		writeConjunct(&compiler, &hasWhere)
		compiler.WriteString("EXISTS (SELECT 1 FROM ")
		compiler.WriteString(userAttributesTable)
		compiler.WriteString(" a WHERE a.project_id = users.project_id AND a.user_id = users.id AND a.key = ")
		compiler.WriteArg(a.Key)
		compiler.WriteString(" AND TO_JSON_STRING(a.value) = ")
		compiler.WriteArg(string(raw))
		compiler.WriteString(")")
	}
	if opts.MembershipTeamID != nil {
		writeConjunct(&compiler, &hasWhere)
		compiler.WriteString("EXISTS (SELECT 1 FROM ")
		compiler.WriteString(teamMembershipsTable)
		compiler.WriteString(" m WHERE m.project_id = users.project_id AND m.user_id = users.id AND m.team_id = ")
		compiler.WriteArg(*opts.MembershipTeamID)
		compiler.WriteString(" AND m.status = ")
		compiler.WriteArg(domain.MembershipStatusActive.String())
		compiler.WriteString(")")
	}

	compileOrderBy(&compiler, filter.Pagination.OrderBy, v2user.Schema)
	compileLimit(&compiler, filter.Pagination.Limit)

	var headers []*domain.User
	err = us.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
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

	return &database.ListResult[*domain.User]{
		Items:      headers,
		NextCursor: v2user.NextCursor(headers, filter.Pagination),
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
		if _, err = tx.Update(ctx, buildStatement(deactivateUserMembershipsStmt,
			domain.MembershipStatusRemoved.String(), projectID, userID,
		).statement()); err != nil {
			return err
		}
		edges := newAuthzMembershipEdgeStatements(tx)
		return authz.UserDeactivated(ctx, &edges, projectID, userID)
	})
}

// DeleteUserByID implements [service.UserStatements].
func (us userStatements) DeleteUserByID(ctx context.Context, projectID, userID string) error {
	return withTransaction(ctx, us.db, func(ctx context.Context, tx queryExecutor) error {
		rsi := newResourceScopeStatements(tx)
		edges := newAuthzMembershipEdgeStatements(tx)
		if err := authz.UserDeleted(ctx, &rsi, &edges, projectID, userID); err != nil {
			return err
		}
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

func (us userStatements) UserExists(ctx context.Context, projectID, userID string) (bool, error) {
	var exists bool
	err := us.db.Query(ctx, buildStatement(userExistsStmt, projectID, userID).statement(),
		func(iter *spanner.RowIterator) error {
			var qErr error
			exists, qErr = collectOneRow(iter, func(row *spanner.Row) (bool, error) {
				var found bool
				return found, row.Columns(&found)
			})
			return qErr
		})
	if err != nil {
		return false, wrapError(err)
	}
	return exists, nil
}

func (us userStatements) hydrateUsers(ctx context.Context, users []*domain.User, opts service.UserQueryOptions) error {
	if len(users) == 0 {
		return nil
	}

	for _, group := range v2user.GroupByProject(users) {
		stmt := buildStatement(userAttributesByIDsQuery, group.ProjectID, group.IDs).statement()
		if len(opts.AttributeKeys) > 0 {
			stmt = buildStatement(userAttributesByIDsAndKeysQuery, group.ProjectID, group.IDs, opts.AttributeKeys).statement()
		}
		if err := us.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				var userID, valueJSON string
				var key domain.AttributeKey
				if err := row.Columns(&userID, &key, &valueJSON); err != nil {
					return err
				}
				var val any
				if err := json.Unmarshal([]byte(valueJSON), &val); err != nil {
					return fmt.Errorf("decode attribute value for %q: %w", key, err)
				}
				user, ok := group.ByID[userID]
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
		&user.Metadata.CreatedAt,
		&user.Metadata.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if lifecycleOwner.Valid {
		v := lifecycleOwner.StringVal
		user.LifecycleOwnerTeamID = &v
	}
	user.Metadata.Status = domain.UserStatus(status)
	return user, nil
}

var _ service.UserStatements = (*userStatements)(nil)
