package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

const (
	createUserHeaderStmt = `INSERT INTO users (project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)`

	createUserAttributeStmt = `INSERT INTO user_attributes (project_id, team_id, user_id, key, value)
VALUES (?, ?, ?, ?, ?)`

	createUserUniqueAttrStmt = `INSERT INTO user_unique_attributes (project_id, user_id, team_id, key, value_hash)
VALUES (?, ?, ?, ?, ?)`

	createUserMembershipStmt = `INSERT INTO team_memberships (project_id, team_id, user_id, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)`

	userQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at FROM users`

	userAttributesByIDsQuery = `SELECT user_id, key, value FROM user_attributes
WHERE project_id = ? AND user_id IN (SELECT value FROM json_each(?))`

	userAttributesByIDsAndKeysQuery = userAttributesByIDsQuery + `
AND key IN (SELECT value FROM json_each(?))`

	deactivateUserStmt = `UPDATE users SET status = ?, updated_at = ?
WHERE project_id = ? AND id = ?`

	deactivateUserMembershipsStmt = `UPDATE team_memberships SET status = ?, updated_at = ?
WHERE project_id = ? AND user_id = ? AND status <> ?`

	deleteUserMembershipsStmt = `DELETE FROM team_memberships WHERE project_id = ? AND user_id = ?`

	// Deactivation must revoke access immediately (ADR 024): tokens and
	// sessions are deleted in the same transaction that flips the status.
	// Hard delete needs no equivalent — the user FK cascades take them.
	revokeUserTokensStmt = `DELETE FROM tokens WHERE project_id = ? AND user_id = ?`

	revokeUserSessionsStmt = `DELETE FROM sessions WHERE project_id = ? AND user_id = ?`

	deleteUserStmt = `DELETE FROM users WHERE project_id = ? AND id = ?`

	userExistsStmt = `SELECT EXISTS (SELECT 1 FROM users WHERE project_id = ? AND id = ?)`
)

type userStatements struct{ statement }

func newUserStatements(client queryExecutor) userStatements {
	return userStatements{statement: statement{client: client}}
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
	now := nowUnixNano()

	return withTransaction(ctx, us.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createUserHeaderStmt,
			user.ProjectID, user.SchemaURL, user.ID, user.LifecycleOwnerTeamID,
			domain.UserStatusActive.String(), now, now,
		); err != nil {
			return wrapError(err)
		}

		for _, a := range user.Attributes {
			raw, err := json.Marshal(a.Value)
			if err != nil {
				return fmt.Errorf("marshal attribute %q: %w", a.Key, err)
			}
			if _, err := tx.Exec(ctx, createUserAttributeStmt,
				user.ProjectID, teamScope, user.ID, string(a.Key), string(raw),
			); err != nil {
				return wrapError(err)
			}
			if a.UniqueScope == domain.AttributeUniquenessUnspecified {
				continue
			}
			scopeTeamID := teamScope
			if a.UniqueScope == domain.AttributeUniquenessProject {
				scopeTeamID = ""
			}
			sum := a.ValueHash
			if _, err := tx.Exec(ctx, createUserUniqueAttrStmt,
				user.ProjectID, user.ID, scopeTeamID, string(a.Key), sum[:],
			); err != nil {
				return wrapError(err)
			}
		}

		initialTeamID := ""
		if user.InitialMembershipTeamID != nil {
			initialTeamID = *user.InitialMembershipTeamID
		}
		if initialTeamID != "" {
			if _, err := tx.Exec(ctx, createUserMembershipStmt,
				user.ProjectID, initialTeamID, user.ID,
				domain.MembershipStatusActive.String(), now, now,
			); err != nil {
				return wrapError(err)
			}
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
		return nil, database.NewNoRowFoundError(nil)
	case 1:
		return result.Items[0], nil
	default:
		return nil, database.NewMultipleRowsFoundError(nil)
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
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		writeConjunct(&compiler, &hasWhere)
		compiler.WriteString("EXISTS (SELECT 1 FROM user_attributes a WHERE a.project_id = users.project_id AND a.user_id = users.id AND a.key = ")
		compiler.WriteArg(string(a.Key))
		compiler.WriteString(" AND a.value = ")
		compiler.WriteArg(string(raw))
		compiler.WriteString(")")
	}
	if opts.MembershipTeamID != nil {
		writeConjunct(&compiler, &hasWhere)
		compiler.WriteString("EXISTS (SELECT 1 FROM team_memberships m WHERE m.project_id = users.project_id AND m.user_id = users.id AND m.team_id = ")
		compiler.WriteArg(*opts.MembershipTeamID)
		compiler.WriteString(" AND m.status = ")
		compiler.WriteArg(domain.MembershipStatusActive.String())
		compiler.WriteString(")")
	}
	maybeWriteAuthzListPredicate(ctx, &compiler, &hasWhere, "users", "id")

	compileOrderBy(&compiler, filter.Pagination.OrderBy, v2user.Schema)
	compileLimit(&compiler, filter.Pagination.Limit)

	rows, err := us.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	headers, err := collectRows(rows, scanUserHeader)
	if err != nil {
		return nil, wrapError(err)
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
	return withTransaction(ctx, us.client, func(ctx context.Context, tx queryExecutor) error {
		now := nowUnixNano()
		n, err := execAffected(ctx, tx, deactivateUserStmt,
			domain.UserStatusDeactivated.String(), now, projectID, userID,
		)
		if err != nil {
			return err
		}
		if n == 0 {
			return database.NewNoRowFoundError(nil)
		}
		if _, err = tx.Exec(ctx, deactivateUserMembershipsStmt,
			domain.MembershipStatusRemoved.String(), now, projectID, userID,
			domain.MembershipStatusRemoved.String(),
		); err != nil {
			return wrapError(err)
		}
		if _, err = tx.Exec(ctx, revokeUserTokensStmt, projectID, userID); err != nil {
			return wrapError(err)
		}
		if _, err = tx.Exec(ctx, revokeUserSessionsStmt, projectID, userID); err != nil {
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
		n, err := execAffected(ctx, tx, deleteUserStmt, projectID, userID)
		if err != nil {
			return err
		}
		if n == 0 {
			return database.NewNoRowFoundError(nil)
		}
		return nil
	})
}

// UserExists implements [service.UserStatements].
func (us userStatements) UserExists(ctx context.Context, projectID, userID string) (bool, error) {
	var exists bool
	if err := us.client.QueryRow(ctx, userExistsStmt, projectID, userID).Scan(&exists); err != nil {
		return false, wrapError(err)
	}
	return exists, nil
}

func (us userStatements) hydrateUsers(ctx context.Context, users []*domain.User, opts service.UserQueryOptions) error {
	if len(users) == 0 {
		return nil
	}

	for _, group := range v2user.GroupByProject(users) {
		if err := us.hydrateUserGroup(ctx, group, opts); err != nil {
			return err
		}
	}
	return nil
}

func (us userStatements) hydrateUserGroup(ctx context.Context, group v2user.ProjectGroup, opts service.UserQueryOptions) error {
	idsJSON, err := json.Marshal(group.IDs)
	if err != nil {
		return err
	}
	var rows *sql.Rows
	if len(opts.AttributeKeys) > 0 {
		var keysJSON []byte
		keysJSON, err = json.Marshal(opts.AttributeKeys)
		if err != nil {
			return err
		}
		rows, err = us.client.Query(ctx, userAttributesByIDsAndKeysQuery, group.ProjectID, string(idsJSON), string(keysJSON))
	} else {
		rows, err = us.client.Query(ctx, userAttributesByIDsQuery, group.ProjectID, string(idsJSON))
	}
	if err != nil {
		return wrapError(err)
	}
	defer rows.Close()

	for rows.Next() {
		var userID, key, valueJSON string
		if err := rows.Scan(&userID, &key, &valueJSON); err != nil {
			return err
		}
		var val any
		if err := json.Unmarshal([]byte(valueJSON), &val); err != nil {
			return fmt.Errorf("decode attribute value for %q: %w", key, err)
		}
		user, ok := group.ByID[userID]
		if !ok {
			continue
		}
		user.Attributes = append(user.Attributes, domain.Attribute{Key: domain.AttributeKey(key), Value: val})
	}
	return wrapError(rows.Err())
}

func scanUserHeader(rows *sql.Rows) (*domain.User, error) {
	user := new(domain.User)
	var (
		lifecycleOwner       sql.NullString
		status               string
		createdNano, updNano int64
	)
	if err := rows.Scan(
		&user.ProjectID,
		&user.SchemaURL,
		&user.ID,
		&lifecycleOwner,
		&status,
		&createdNano,
		&updNano,
	); err != nil {
		return nil, err
	}
	if lifecycleOwner.Valid {
		v := lifecycleOwner.String
		user.LifecycleOwnerTeamID = &v
	}
	user.Metadata.Status = domain.UserStatus(status)
	user.Metadata.CreatedAt = timeFromUnixNano(createdNano)
	user.Metadata.UpdatedAt = timeFromUnixNano(updNano)
	return user, nil
}

var _ service.UserStatements = (*userStatements)(nil)
