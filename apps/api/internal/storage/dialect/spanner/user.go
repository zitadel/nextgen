package spanner

import (
	"context"
	"encoding/json"
	"fmt"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	v2user "github.com/zitadel/nextgen/internal/storage/user"
)

var userSchema = v2user.NewSchema(v2user.SchemaSQL{})

const (
	createUserHeaderStmt = `INSERT INTO users (project_id, schema_url, id, lifecycle_owner_team_id, status)
VALUES (@p1, @p2, @p3, @p4, @p5)`

	createUserAttributeStmt = `INSERT INTO user_attributes (project_id, user_id, key, value, unique_team_id, value_hash, search_text)
VALUES (@p1, @p2, @p3, PARSE_JSON(@p4), @p5, @p6, @p7)`

	createUserMembershipStmt = `INSERT INTO team_memberships (project_id, team_id, user_id, status)
VALUES (@p1, @p2, @p3, @p4)`

	userAttributesTable = "user_attributes"

	userQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at FROM users`

	// userSearchIndexArm opens one range of a user search across projects,
	// which carries the project and property its rows answer for.
	userSearchIndexArm = `(SELECT project_id, key, user_id, search_text FROM user_attributes WHERE search_text IS NOT NULL AND project_id = `

	// userSearchQuery and userSearchJoin frame the one range of
	// idx_user_attributes_search a search arm reads; see the postgres peer.
	// The index is NULL_FILTERED, which Spanner only reads for a query that
	// rules NULL out itself, hence the IS NOT NULL.
	userSearchQuery = `SELECT project_id, schema_url, id, lifecycle_owner_team_id, status, created_at, updated_at, ` + v2user.SearchTextColumn + `
FROM users
JOIN (SELECT project_id AS ` + v2user.SearchProjectIDColumn + `, user_id AS ` + v2user.SearchUserIDColumn + `, search_text AS ` + v2user.SearchTextColumn + `
      FROM user_attributes
      WHERE search_text IS NOT NULL AND project_id = `
	userSearchJoin = `) ua ON ua.` + v2user.SearchProjectIDColumn + ` = users.project_id AND ua.` + v2user.SearchUserIDColumn + ` = users.id`

	userAttributesByIDsQuery = `SELECT user_id, key, TO_JSON_STRING(value) FROM user_attributes
WHERE project_id = @p1 AND user_id IN UNNEST(@p2)`

	userAttributesByIDsAndKeysQuery = userAttributesByIDsQuery + `
AND key IN UNNEST(@p3)`

	// userTeamsByIDsQuery hydrates the team memberships of one page of users
	// (ADR 059), ordered so each user's rows arrive together and by team name.
	//
	// No per-user ROW_NUMBER window to bound the read: the emulator answers
	// "Analytic functions not supported", and stmttest holds all three
	// dialects to the same behavior. The cap is applied in Go instead.
	userTeamsByIDsQuery = `SELECT m.user_id, m.team_id, t.name, m.status, m.created_at, m.updated_at
FROM team_memberships m
JOIN teams t ON t.project_id = m.project_id AND t.id = m.team_id
WHERE m.project_id = @p1
  AND m.user_id IN UNNEST(@p2)
  AND m.status IN UNNEST(@p3)
ORDER BY m.user_id, t.name, m.team_id`

	// ownerTeamsByIDsQuery hydrates the lifecycle owner teams of one page of
	// users (ADR 059), keyed on the distinct owner ids the page returned.
	ownerTeamsByIDsQuery = `SELECT id, name, status, created_at, updated_at
FROM teams
WHERE project_id = @p1 AND id IN UNNEST(@p2)`

	// patchUserHeaderStmt rewrites the header row. The updated_at predicate is
	// the optimistic guard: a row that moved past the value the merge was
	// computed against matches nothing, and the caller retries from a fresh
	// read.
	patchUserHeaderStmt = `UPDATE users SET updated_at = CURRENT_TIMESTAMP(), schema_url = @p1
WHERE project_id = @p2 AND id = @p3 AND updated_at = @p4`

	selectUserUniqueAttrScopesStmt = `SELECT key, unique_team_id FROM user_attributes WHERE project_id = @p1 AND user_id = @p2 AND value_hash IS NOT NULL`

	deleteUserAttributesStmt = `DELETE FROM user_attributes WHERE project_id = @p1 AND user_id = @p2`

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

		if err := insertUserAttributes(ctx, tx, user.ProjectID, user.ID, user.Attributes,
			user.Attributes.UniqueTeamScopes(nil, teamScope)); err != nil {
			return err
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
		team, hash := spanner.NullString{}, []byte(nil)
		if a.UniqueScope != domain.AttributeUniquenessUnspecified {
			sum := a.ValueHash
			team, hash = spanner.NullString{StringVal: uniqueTeams[i], Valid: true}, append([]byte(nil), sum[:]...)
		}
		searchText := spanner.NullString{}
		if a.SearchText != nil {
			searchText = spanner.NullString{StringVal: *a.SearchText, Valid: true}
		}
		if _, err := tx.Update(ctx, buildStatement(createUserAttributeStmt,
			projectID, userID, a.Key, string(raw), team, hash, searchText,
		).statement()); err != nil {
			return err
		}
	}
	return nil
}

// GetUserUniqueAttributeScopes implements [service.UserStatements].
func (us userStatements) GetUserUniqueAttributeScopes(ctx context.Context, projectID, userID string) (map[domain.AttributeKey]string, error) {
	scopes := make(map[domain.AttributeKey]string)
	err := us.db.Query(ctx, buildStatement(selectUserUniqueAttrScopesStmt, projectID, userID).statement(),
		func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				var key, team string
				if err := row.Columns(&key, &team); err != nil {
					return err
				}
				scopes[domain.AttributeKey(key)] = team
				return nil
			})
		})
	if err != nil {
		return nil, err
	}
	return scopes, nil
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
	var keys []domain.AttributeKey
	err := us.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		return iter.Do(func(row *spanner.Row) error {
			var key string
			if err := row.Columns(&key); err != nil {
				return err
			}
			keys = append(keys, domain.AttributeKey(key))
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	return keys, nil
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
	return withTransaction(ctx, us.db, func(ctx context.Context, tx queryExecutor) error {
		n, err := tx.Update(ctx, buildStatement(patchUserHeaderStmt,
			user.SchemaURL, user.ProjectID, user.UserID, user.ExpectedUpdatedAt,
		).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return wrapError(spanner.ErrRowNotFound)
		}
		if _, err := tx.Update(ctx, buildStatement(deleteUserAttributesStmt, user.ProjectID, user.UserID).statement()); err != nil {
			return err
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
		return nil, wrapError(spanner.ErrRowNotFound)
	case 1:
		return result.Items[0], nil
	default:
		return nil, wrapError(errTooManyRows)
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

		hasWhere := false
		if readFilter != nil {
			writeConjunct(&compiler, &hasWhere)
			compileFilter(&compiler, readFilter, userSchema)
		}
		for _, a := range opts.Attributes {
			writeConjunct(&compiler, &hasWhere)
			if opts.UniqueAttributesOnly {
				hash, err := domain.UniqueValueHash(a.Value)
				if err != nil {
					return nil, fmt.Errorf("hash attribute %q: %w", a.Key, err)
				}
				compiler.WriteString("users.id IN (SELECT ua.user_id FROM user_attributes ua WHERE ua.project_id = users.project_id AND ua.key = ")
				compiler.WriteArg(a.Key)
				compiler.WriteString(" AND ua.value_hash = ")
				compiler.WriteArg(hash[:])
				if opts.UniqueTeamID != nil {
					compiler.WriteString(" AND ua.unique_team_id = ")
					compiler.WriteArg(*opts.UniqueTeamID)
				}
				compiler.WriteString(")")
				continue
			}
			raw, err := json.Marshal(a.Value)
			if err != nil {
				return nil, fmt.Errorf("marshal attribute %q: %w", a.Key, err)
			}
			compiler.WriteString("EXISTS (SELECT 1 FROM ")
			compiler.WriteString(userAttributesTable)
			compiler.WriteString(" a WHERE a.project_id = users.project_id AND a.user_id = users.id AND a.key = ")
			compiler.WriteArg(a.Key)
			compiler.WriteString(" AND TO_JSON_STRING(a.value) = ")
			compiler.WriteArg(string(raw))
			compiler.WriteString(")")
		}
		writeMembershipConjunct(&compiler, &hasWhere, opts.MembershipTeamID)
		maybeWriteAuthzListPredicate(ctx, &compiler, &hasWhere, "users", "id")

		compileOrderBy(&compiler, filter.Pagination.OrderBy, userSchema)
		compileLimit(&compiler, limit)

		var headers []*domain.User
		err := us.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var qErr error
			headers, qErr = collectRows(iter, us.scanUserHeader)
			return qErr
		})
		return headers, err
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

// SearchUserIndex implements [service.UserStatements]: one UNION ALL of one
// range of idx_user_attributes_search per arm, each with its own ORDER BY and
// LIMIT, so each is one range of the index read to the limit, and nothing else
// is read. The index is NULL_FILTERED, hence the IS NOT NULL.
func (us userStatements) SearchUserIndex(ctx context.Context, ranges []domain.UserSearchRange, prefix string, limit int) ([]domain.UserSearchRange, error) {
	if err := authz.RequireUnfilteredBatch(ctx); err != nil {
		return nil, err
	}
	if len(ranges) == 0 {
		return ranges, nil
	}
	lower, upper, bounded := v2user.SearchBounds(prefix)
	var compiler statementCompiler
	for i, r := range ranges {
		if i > 0 {
			compiler.WriteString(" UNION ALL ")
		}
		compiler.WriteString(userSearchIndexArm)
		compiler.WriteArg(r.ProjectID)
		compiler.WriteString(" AND key = ")
		compiler.WriteArg(string(r.Key))
		compiler.WriteString(" AND search_text >= ")
		compiler.WriteArg(lower)
		if bounded {
			compiler.WriteString(" AND search_text < ")
			compiler.WriteArg(upper)
		}
		compiler.WriteString(" ORDER BY search_text, user_id")
		compileLimit(&compiler, uint32(limit))
		compiler.WriteString(")")
	}
	arms := v2user.SearchIndexArms(ranges)
	err := us.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		return iter.Do(func(row *spanner.Row) error {
			var projectID, key string
			var hit domain.UserSearchHit
			if err := row.Columns(&projectID, &key, &hit.UserID, &hit.MatchedText); err != nil {
				return err
			}
			arm := arms[v2user.SearchIndexArm{ProjectID: projectID, Key: domain.AttributeKey(key)}]
			ranges[arm].Hits = append(ranges[arm].Hits, hit)
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	return v2user.MarkSearchIndexFull(ranges, limit), nil
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

		var found []*domain.User
		if err := us.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var qErr error
			found, qErr = collectRows(iter, scanUserSearchHeader)
			return qErr
		}); err != nil {
			return nil, err
		}
		pages = append(pages, found)
	}
	return v2user.MergeSearchPages(pages, limit), nil
}

// writeMembershipConjunct requires an active membership of teamID, when set.
func writeMembershipConjunct(c *statementCompiler, hasWhere *bool, teamID *string) {
	if teamID == nil {
		return
	}
	writeConjunct(c, hasWhere)
	c.WriteString("EXISTS (SELECT 1 FROM ")
	c.WriteString(teamMembershipsTable)
	c.WriteString(" m WHERE m.project_id = users.project_id AND m.user_id = users.id AND m.team_id = ")
	c.WriteArg(*teamID)
	c.WriteString(" AND m.status = ")
	c.WriteArg(domain.MembershipStatusActive.String())
	c.WriteString(")")
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

	// Grouped once and reused: GroupByProject clears Attributes, so a second
	// pass would wipe the ones this call just hydrated.
	groups := v2user.GroupByProject(users)
	defer v2user.FillRepeats(groups)

	for _, group := range groups {
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
		stmt := buildStatement(userTeamsByIDsQuery, group.ProjectID, group.IDs, v2user.MembershipStatusStrings()).statement()
		if err := us.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				var (
					userID string
					team   domain.UserTeam
					status string
				)
				if err := row.Columns(&userID, &team.TeamID, &team.TeamName, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
					return err
				}
				team.ProjectID = group.ProjectID
				team.UserID = userID
				team.Status = domain.MembershipStatus(status)
				collector.Add(userID, team)
				return nil
			})
		}); err != nil {
			return err
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

		stmt := buildStatement(ownerTeamsByIDsQuery, group.ProjectID, teamIDs).statement()
		if err := us.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
			return iter.Do(func(row *spanner.Row) error {
				var (
					team   domain.Team
					status string
				)
				if err := row.Columns(&team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
					return err
				}
				team.ProjectID = group.ProjectID
				team.Status = domain.TeamStatus(status)
				collector.Add(team)
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
	return user, scanUserColumns(row, user)
}

// scanUserSearchHeader scans a search read's row: the user header, then the
// text the user matched on.
func scanUserSearchHeader(row *spanner.Row) (*domain.User, error) {
	user := new(domain.User)
	return user, scanUserColumns(row, user, &user.MatchedText)
}

// scanUserColumns scans the user header columns into user, then the columns a
// read selects after them into more.
func scanUserColumns(row *spanner.Row, user *domain.User, more ...any) error {
	var (
		lifecycleOwner spanner.NullString
		status         string
	)
	if err := row.Columns(append([]any{
		&user.ProjectID,
		&user.SchemaURL,
		&user.ID,
		&lifecycleOwner,
		&status,
		&user.Metadata.CreatedAt,
		&user.Metadata.UpdatedAt,
	}, more...)...); err != nil {
		return err
	}
	if lifecycleOwner.Valid {
		v := lifecycleOwner.StringVal
		user.LifecycleOwnerTeamID = &v
	}
	user.Metadata.Status = domain.UserStatus(status)
	return nil
}

var _ service.UserStatements = (*userStatements)(nil)
