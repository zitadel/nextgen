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
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

var userSchema = v2user.NewSchema(v2user.SchemaSQL{})

const (
	createUserHeaderStmt = `INSERT INTO users (project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)`

	createUserAttributeStmt = `INSERT INTO user_attributes (project_id, user_id, key, value, unique_team_id, value_hash, search_text)
VALUES (?, ?, ?, ?, ?, ?, ?)`

	createUserMembershipStmt = `INSERT INTO team_memberships (project_id, team_id, user_id, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)`

	userQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at FROM users`

	// userSearchQuery and userSearchJoin frame the one range of
	// idx_user_attributes_search a search arm reads; see the postgres peer.
	userSearchQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at, ` + v2user.SearchTextColumn + `
FROM users
JOIN (SELECT project_id AS ` + v2user.SearchProjectIDColumn + `, user_id AS ` + v2user.SearchUserIDColumn + `, search_text AS ` + v2user.SearchTextColumn + `
      FROM user_attributes
      WHERE search_text IS NOT NULL AND project_id = `
	userSearchJoin = `) ua ON ua.` + v2user.SearchProjectIDColumn + ` = users.project_id AND ua.` + v2user.SearchUserIDColumn + ` = users.id`

	userAttributesByIDsQuery = `SELECT user_id, key, value FROM user_attributes
WHERE project_id = ? AND user_id IN (SELECT value FROM json_each(?))`

	userAttributesByIDsAndKeysQuery = userAttributesByIDsQuery + `
AND key IN (SELECT value FROM json_each(?))`

	// userTeamsByIDsQuery hydrates the team memberships of one page of users
	// (ADR 059), ordered so each user's rows arrive together and by team name.
	// The cap is applied in Go — see the note on the postgres query for why a
	// per-user window function is not used.
	userTeamsByIDsQuery = `SELECT m.user_id, m.team_id, t.name, m.status, m.created_at, m.updated_at
FROM team_memberships m
JOIN teams t ON t.project_id = m.project_id AND t.id = m.team_id
WHERE m.project_id = ?
  AND m.user_id IN (SELECT value FROM json_each(?))
  AND m.status IN (SELECT value FROM json_each(?))
ORDER BY m.user_id, t.name, m.team_id`

	// ownerTeamsByIDsQuery hydrates the lifecycle owner teams of one page of
	// users (ADR 059), keyed on the distinct owner ids the page returned.
	ownerTeamsByIDsQuery = `SELECT id, name, status, created_at, updated_at
FROM teams
WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))`

	// patchUserHeaderStmt rewrites the header row. The updated_at predicate is
	// the optimistic guard: a row that moved past the value the merge was
	// computed against matches nothing, and the caller retries from a fresh
	// read.
	patchUserHeaderStmt = `UPDATE users SET updated_at = ?, schema_url = ?
WHERE project_id = ? AND id = ? AND updated_at = ?`

	selectUserUniqueAttrScopesStmt = `SELECT key, unique_team_id FROM user_attributes WHERE project_id = ? AND user_id = ? AND value_hash IS NOT NULL`

	deleteUserAttributesStmt = `DELETE FROM user_attributes WHERE project_id = ? AND user_id = ?`

	deactivateUserStmt = `UPDATE users SET status = ?, updated_at = ?
WHERE project_id = ? AND id = ?`

	deactivateUserMembershipsStmt = `UPDATE team_memberships SET status = ?, updated_at = ?
WHERE project_id = ? AND user_id = ? AND status <> ?`

	deleteUserMembershipsStmt = `DELETE FROM team_memberships WHERE project_id = ? AND user_id = ?`

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

		if err := insertUserAttributes(ctx, tx, user.ProjectID, user.ID, user.Attributes,
			user.Attributes.UniqueTeamScopes(nil, teamScope)); err != nil {
			return err
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

// insertUserAttributes writes one attribute row per entry, with the team
// scope and value hash set for a unique-scoped value and the search text for
// one a search reads. uniqueTeams is index-aligned with attrs (see
// [domain.CreateAttributes.UniqueTeamScopes]).
func insertUserAttributes(ctx context.Context, tx queryExecutor, projectID, userID string, attrs domain.CreateAttributes, uniqueTeams []string) error {
	for i, a := range attrs {
		raw, err := json.Marshal(a.Value)
		if err != nil {
			return fmt.Errorf("marshal attribute %q: %w", a.Key, err)
		}
		var team, hash, searchText any
		if a.UniqueScope != domain.AttributeUniquenessUnspecified {
			sum := a.ValueHash
			team, hash = uniqueTeams[i], sum[:]
		}
		if a.SearchText != nil {
			searchText = *a.SearchText
		}
		if _, err := tx.Exec(ctx, createUserAttributeStmt,
			projectID, userID, string(a.Key), string(raw), team, hash, searchText,
		); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

// GetUserUniqueAttributeScopes implements [service.UserStatements].
func (us userStatements) GetUserUniqueAttributeScopes(ctx context.Context, projectID, userID string) (map[domain.AttributeKey]string, error) {
	rows, err := us.client.Query(ctx, selectUserUniqueAttrScopesStmt, projectID, userID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()

	scopes := make(map[domain.AttributeKey]string)
	for rows.Next() {
		var key, team string
		if err := rows.Scan(&key, &team); err != nil {
			return nil, err
		}
		scopes[domain.AttributeKey(key)] = team
	}
	return scopes, wrapError(rows.Err())
}

// GetTakenUniqueAttributeKeys implements [service.UserStatements].
func (us userStatements) GetTakenUniqueAttributeKeys(ctx context.Context, projectID, userID string, claims []service.UniqueAttributeClaim) ([]domain.AttributeKey, error) {
	if len(claims) == 0 {
		return nil, nil
	}
	var compiler statementCompiler
	compiler.WriteString("SELECT key FROM user_attributes WHERE project_id = ")
	compiler.WriteArg(projectID)
	compiler.WriteString(" AND user_id <> ")
	compiler.WriteArg(userID)
	compiler.WriteString(" AND (")
	for i, claim := range claims {
		if i > 0 {
			compiler.WriteString(" OR ")
		}
		compiler.WriteString("(unique_team_id = ")
		compiler.WriteArg(claim.TeamID)
		compiler.WriteString(" AND key = ")
		compiler.WriteArg(claim.Key)
		compiler.WriteString(" AND value_hash = ")
		compiler.WriteArg(claim.ValueHash[:])
		compiler.WriteString(")")
	}
	compiler.WriteString(")")
	rows, err := us.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()

	var keys []domain.AttributeKey
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, domain.AttributeKey(key))
	}
	return keys, wrapError(rows.Err())
}

// PatchUser implements [service.UserStatements] as a full rewrite of the
// user's attribute rows; a unique value colliding with another user's claim
// still surfaces as a UniqueError.
func (us userStatements) PatchUser(ctx context.Context, user *domain.PatchUser) error {
	if len(user.Attributes) == 0 {
		return fmt.Errorf("user patch requires attributes")
	}
	if len(user.UniqueTeamScopes) != len(user.Attributes) {
		return fmt.Errorf("user patch requires one unique team scope per attribute")
	}
	return withTransaction(ctx, us.client, func(ctx context.Context, tx queryExecutor) error {
		n, err := execAffected(ctx, tx, patchUserHeaderStmt,
			nowUnixNano(), user.SchemaURL, user.ProjectID, user.UserID, user.ExpectedUpdatedAt.UnixNano(),
		)
		if err != nil {
			return err
		}
		if n == 0 {
			return database.NewNoRowFoundError(nil)
		}
		if _, err := tx.Exec(ctx, deleteUserAttributesStmt, user.ProjectID, user.UserID); err != nil {
			return wrapError(err)
		}
		return insertUserAttributes(ctx, tx, user.ProjectID, user.UserID, user.Attributes,
			user.UniqueTeamScopes)
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
	filter, err := v2user.ListOptions(filter, opts.Search != nil)
	if err != nil {
		return nil, err
	}

	readFilter, err := v2user.ApplyCursor(userSchema, filter.Filter, filter.Pagination)
	if err != nil {
		return nil, err
	}

	headers, nextCursor, err := pagination.Page(filter.Pagination, userSchema, func(limit uint32) ([]*domain.User, error) {
		if opts.Search != nil {
			return us.searchUsers(ctx, readFilter, filter.Pagination, opts, limit)
		}
		var compiler statementCompiler
		compiler.WriteString(userQuery)
		if opts.UniqueAttributesOnly {
			for i, a := range opts.Attributes {
				hash, err := domain.UniqueValueHash(a.Value)
				if err != nil {
					return nil, fmt.Errorf("hash attribute %q: %w", a.Key, err)
				}
				// A join, not IN: under a filter on an indexed users column
				// (schema_url) SQLite walks those users and probes the attributes
				// per row. The subquery renames its columns so the unqualified
				// users filter stays unambiguous; SQLite pushes the outer
				// project_id equality into it. A user holds one row per key, so
				// the join keeps one row per user and LIMIT counts users.
				alias := fmt.Sprintf("ua%d", i)
				compiler.WriteString(" JOIN (SELECT project_id AS ua_project_id, user_id AS ua_user_id FROM user_attributes WHERE key = ")
				compiler.WriteArg(string(a.Key))
				compiler.WriteString(" AND value_hash = ")
				compiler.WriteArg(hash[:])
				if opts.UniqueTeamID != nil {
					compiler.WriteString(" AND unique_team_id = ")
					compiler.WriteArg(*opts.UniqueTeamID)
				}
				compiler.WriteString(") " + alias + " ON " + alias + ".ua_project_id = users.project_id AND " + alias + ".ua_user_id = users.id")
			}
		}

		hasWhere := false
		if readFilter != nil {
			writeConjunct(&compiler, &hasWhere)
			compileFilter(&compiler, readFilter, userSchema)
		}
		if !opts.UniqueAttributesOnly {
			for _, a := range opts.Attributes {
				writeConjunct(&compiler, &hasWhere)
				raw, err := json.Marshal(a.Value)
				if err != nil {
					return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
				}
				compiler.WriteString("EXISTS (SELECT 1 FROM user_attributes a WHERE a.project_id = users.project_id AND a.user_id = users.id AND a.key = ")
				compiler.WriteArg(string(a.Key))
				compiler.WriteString(" AND a.value = ")
				compiler.WriteArg(string(raw))
				compiler.WriteString(")")
			}
		}
		writeMembershipConjunct(&compiler, &hasWhere, opts.MembershipTeamID)
		maybeWriteAuthzListPredicate(ctx, &compiler, &hasWhere, "users", "id")

		compileOrderBy(&compiler, filter.Pagination.OrderBy, userSchema)
		compileLimit(&compiler, limit)

		rows, err := us.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		defer rows.Close()
		headers, err := collectRows(rows, scanUserHeader)
		if err != nil {
			return nil, wrapError(err)
		}
		return headers, nil
	})
	if err != nil {
		return nil, err
	}
	if err := us.hydrateUsers(ctx, headers, opts); err != nil {
		return nil, err
	}

	return &database.ListResult[*domain.User]{
		Items:      headers,
		NextCursor: nextCursor,
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
		if opts.IncludeTeams {
			if err := us.hydrateUserGroupTeams(ctx, group, opts); err != nil {
				return err
			}
		}
		if opts.IncludeLifecycleOwnerTeam {
			if err := us.hydrateUserGroupOwnerTeams(ctx, group); err != nil {
				return err
			}
		}
	}
	return nil
}

// hydrateUserGroupTeams loads the team memberships of an already-read page of users
// (ADR 059): one batched query keyed on the ids the page already returned.
// Joining memberships into the user query instead would multiply rows — LIMIT
// would count memberships rather than users, and the keyset cursor is
// marshalled from the last row's sort values, so fan-out corrupts it.
func (us userStatements) hydrateUserGroupTeams(ctx context.Context, group v2user.ProjectGroup, opts service.UserQueryOptions) error {
	limit := opts.TeamsLimit
	if limit <= 0 {
		limit = service.DefaultUserTeamsLimit
	}

	idsJSON, err := json.Marshal(group.IDs)
	if err != nil {
		return err
	}
	statusesJSON, err := json.Marshal(v2user.MembershipStatusStrings())
	if err != nil {
		return err
	}

	collector := v2user.NewTeamCollector(group, limit)
	rows, err := us.client.Query(ctx, userTeamsByIDsQuery, group.ProjectID, string(idsJSON), string(statusesJSON))
	if err != nil {
		return wrapError(err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			userID               string
			team                 domain.UserTeam
			status               string
			createdNano, updNano int64
		)
		// Timestamps come back as unix nanos here, the same way scanUserTeam
		// reads them for the paginated membership list.
		if err := rows.Scan(&userID, &team.TeamID, &team.TeamName, &status, &createdNano, &updNano); err != nil {
			return err
		}
		team.ProjectID = group.ProjectID
		team.UserID = userID
		team.Status = domain.MembershipStatus(status)
		team.CreatedAt = timeFromUnixNano(createdNano)
		team.UpdatedAt = timeFromUnixNano(updNano)
		collector.Add(userID, team)
	}
	return wrapError(rows.Err())
}

// hydrateUserGroupOwnerTeams loads the lifecycle owner teams of an already-read
// page of users (ADR 059), keyed on the distinct owner ids the page returned.
// A page of self-owned users runs no query at all.
func (us userStatements) hydrateUserGroupOwnerTeams(ctx context.Context, group v2user.ProjectGroup) error {
	collector := v2user.NewOwnerTeamCollector(group)
	teamIDs := collector.TeamIDs()
	if len(teamIDs) == 0 {
		return nil
	}

	idsJSON, err := json.Marshal(teamIDs)
	if err != nil {
		return err
	}

	rows, err := us.client.Query(ctx, ownerTeamsByIDsQuery, group.ProjectID, string(idsJSON))
	if err != nil {
		return wrapError(err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			team                 domain.Team
			status               string
			createdNano, updNano int64
		)
		// Unix nanos here, the same way the membership hydrate reads them.
		if err := rows.Scan(&team.ID, &team.Name, &status, &createdNano, &updNano); err != nil {
			return err
		}
		team.ProjectID = group.ProjectID
		team.Status = domain.TeamStatus(status)
		team.CreatedAt = timeFromUnixNano(createdNano)
		team.UpdatedAt = timeFromUnixNano(updNano)
		collector.Add(team)
	}
	return wrapError(rows.Err())
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
	return user, scanUserColumns(rows, user)
}

// scanUserSearchHeader scans a search read's row: the user header, then the
// text the user matched on.
func scanUserSearchHeader(rows *sql.Rows) (*domain.User, error) {
	user := new(domain.User)
	return user, scanUserColumns(rows, user, &user.MatchedText)
}

// scanUserColumns scans the user header columns into user, then the columns a
// read selects after them into more.
func scanUserColumns(rows *sql.Rows, user *domain.User, more ...any) error {
	var (
		lifecycleOwner       sql.NullString
		status               string
		createdNano, updNano int64
	)
	if err := rows.Scan(append([]any{
		&user.ProjectID,
		&user.SchemaURL,
		&user.ID,
		&lifecycleOwner,
		&status,
		&createdNano,
		&updNano,
	}, more...)...); err != nil {
		return err
	}
	if lifecycleOwner.Valid {
		v := lifecycleOwner.String
		user.LifecycleOwnerTeamID = &v
	}
	user.Metadata.Status = domain.UserStatus(status)
	user.Metadata.CreatedAt = timeFromUnixNano(createdNano)
	user.Metadata.UpdatedAt = timeFromUnixNano(updNano)
	return nil
}

// searchUsers runs a search read (see [service.UserSearch]): one statement
// per arm, each a range of idx_user_attributes_search joined to its users and
// read in index order. The arms' pages are merged into the one order they
// share.
func (us userStatements) searchUsers(ctx context.Context, readFilter database.Filter[domain.UserField], page database.Page[domain.UserField], opts service.UserQueryOptions, limit uint32) ([]*domain.User, error) {
	if opts.UniqueAttributesOnly || len(opts.Attributes) > 0 {
		return nil, fmt.Errorf("user search cannot be combined with an attribute match")
	}
	search := opts.Search
	lower, upper, bounded := v2user.SearchBounds(search.Prefix)
	lower, err := v2user.SearchLower(lower, page)
	if err != nil {
		return nil, err
	}

	pages := make([][]*domain.User, 0, len(search.Arms))
	for _, arm := range search.Arms {
		var compiler statementCompiler
		compiler.WriteString(userSearchQuery)
		compiler.WriteArg(search.ProjectID)
		compiler.WriteString(" AND key = ")
		compiler.WriteArg(string(arm.Key))
		compiler.WriteString(" AND search_text >= ")
		compiler.WriteArg(lower)
		if bounded {
			compiler.WriteString(" AND search_text < ")
			compiler.WriteArg(upper)
		}
		compiler.WriteString(userSearchJoin)

		hasWhere := false
		if armFilter := database.And(readFilter, arm.Users); len(armFilter.Filters) > 0 {
			writeConjunct(&compiler, &hasWhere)
			compileFilter(&compiler, armFilter, userSchema)
		}
		writeMembershipConjunct(&compiler, &hasWhere, opts.MembershipTeamID)
		maybeWriteAuthzListPredicate(ctx, &compiler, &hasWhere, "users", "id")

		compileOrderBy(&compiler, page.OrderBy, userSchema)
		compileLimit(&compiler, limit)

		found, err := us.querySearchArm(ctx, &compiler)
		if err != nil {
			return nil, err
		}
		pages = append(pages, found)
	}
	return v2user.MergeSearchPages(pages, limit), nil
}

// querySearchArm runs one arm's statement. It is its own function so the rows
// close before the next arm's statement runs.
func (us userStatements) querySearchArm(ctx context.Context, compiler *statementCompiler) ([]*domain.User, error) {
	rows, err := us.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	found, err := collectRows(rows, scanUserSearchHeader)
	if err != nil {
		return nil, wrapError(err)
	}
	return found, nil
}

// writeMembershipConjunct requires an active membership of teamID, when set.
func writeMembershipConjunct(c *statementCompiler, hasWhere *bool, teamID *string) {
	if teamID == nil {
		return
	}
	writeConjunct(c, hasWhere)
	c.WriteString("EXISTS (SELECT 1 FROM team_memberships m WHERE m.project_id = users.project_id AND m.user_id = users.id AND m.team_id = ")
	c.WriteArg(*teamID)
	c.WriteString(" AND m.status = ")
	c.WriteArg(domain.MembershipStatusActive.String())
	c.WriteString(")")
}

var _ service.UserStatements = (*userStatements)(nil)
