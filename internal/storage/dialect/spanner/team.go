package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	teamsTable     = "teams"
	createTeamStmt = `INSERT INTO teams (project_id, id, name) VALUES (@p1, @p2, @p3) THEN RETURN project_id, id, name, status, created_at, updated_at`
	teamQuery      = `SELECT project_id, id, name, status, created_at, updated_at FROM teams`
	updateTeamStmt = `UPDATE teams SET name = @p3, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p1 AND id = @p2 AND status = @p4 THEN RETURN project_id, id, name, status, created_at, updated_at`

	deactivateTeamStmt = `
UPDATE teams
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND id = @p3 AND status = @p4`

	deactivateTeamMembershipsStmt = `
UPDATE team_memberships
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND team_id = @p3 AND status <> @p1`

	deactivateTeamOwnedUsersStmt = `
UPDATE users
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND lifecycle_owner_team_id = @p3 AND status <> @p1`

	deactivateOwnedUsersMembershipsStmt = `
UPDATE team_memberships
SET status = @p1, updated_at = CURRENT_TIMESTAMP()
WHERE project_id = @p2 AND status <> @p1
  AND user_id IN (
    SELECT id FROM users
    WHERE project_id = @p3 AND lifecycle_owner_team_id = @p4
  )`
)

var teamColumns = []string{
	"project_id", "id", "name", "status", "created_at", "updated_at",
}

type teamStatements struct{ statement }

func newTeamStatements(db queryExecutor) teamStatements {
	return teamStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateTeam implements [service.TeamStatements].
func (ts teamStatements) CreateTeam(ctx context.Context, team *domain.Team) error {
	if err := ensureManagedID(&team.ID, domain.PrefixTeam); err != nil {
		return err
	}
	return withTransaction(ctx, ts.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createTeamStmt, team.ProjectID, team.ID, team.Name).statement()
		if err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				var status string
				if err := row.Columns(&team.ProjectID, &team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
					return struct{}{}, err
				}
				team.Status = domain.TeamStatus(status)
				return struct{}{}, nil
			})
			return err
		}); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewTeamResourceScope(team.ProjectID, team.ID))
	})
}

// GetTeamByID implements [service.TeamStatements].
func (ts teamStatements) GetTeamByID(ctx context.Context, projectID, id string) (*domain.Team, error) {
	row, err := ts.db.ReadRow(ctx, teamsTable, spanner.Key{projectID, id}, teamColumns)
	if err != nil {
		return nil, err
	}
	return ts.scanTeam(row)
}

// UpdateTeam implements [service.TeamStatements].
// The whole team is returned after the update.
// Only active teams are updated.
// Update of a deactivated or a non-existent team returns [database.NoRowFoundError].
func (ts teamStatements) UpdateTeam(ctx context.Context, team *domain.Team) error {
	stmt := buildStatement(updateTeamStmt, team.ProjectID, team.ID, team.Name, domain.TeamStatusActive.String()).statement()
	return ts.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		updated, err := collectOneRow(iter, ts.scanTeam)
		if err != nil {
			return err
		}
		*team = *updated
		return nil
	})
}

// ListTeams implements [service.TeamStatements].
func (ts teamStatements) ListTeams(ctx context.Context, filter *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, teamQuery, filter, teamSchema); err != nil {
		return nil, err
	}

	var teams []*domain.Team
	err := ts.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		teams, err = collectRows(iter, ts.scanTeam)
		return err
	})
	if err != nil {
		return nil, err
	}

	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(teams) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.TeamField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  teamSchema.ValuesFrom(teams[len(teams)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.Team]{
		Items:      teams,
		NextCursor: nextCursor,
	}, nil
}

// DeactivateTeam implements [service.TeamStatements].
// Deactivating a team that is not active is a no-op, so updated_at records when
// the team was deactivated, not when delete was last called.
func (ts teamStatements) DeactivateTeam(ctx context.Context, projectID, id string) error {
	membershipRemoved := domain.MembershipStatusRemoved.String()
	userDeactivated := domain.UserStatusDeactivated.String()
	teamDeactivated := domain.TeamStatusDeactivated.String()
	teamActive := domain.TeamStatusActive.String()

	return withTransaction(ctx, ts.db, func(ctx context.Context, tx queryExecutor) error {
		affected, err := tx.Update(ctx, buildStatement(deactivateTeamStmt, teamDeactivated, projectID, id, teamActive).statement())
		if err != nil {
			return err
		}
		// No active team: unknown, or already tombstoned.
		if affected == 0 {
			return nil
		}

		for _, step := range []struct {
			sql  string
			args []any
		}{
			{deactivateTeamMembershipsStmt, []any{membershipRemoved, projectID, id}},
			{deactivateTeamOwnedUsersStmt, []any{userDeactivated, projectID, id}},
			{deactivateOwnedUsersMembershipsStmt, []any{membershipRemoved, projectID, projectID, id}},
		} {
			if _, err := tx.Update(ctx, buildStatement(step.sql, step.args...).statement()); err != nil {
				return err
			}
		}
		edges := newAuthzMembershipEdgeStatements(tx)
		return edges.DeleteAuthzMembershipEdgesForTeamDeactivate(ctx, projectID, id)
	})
}

func (ts teamStatements) scanTeam(row *spanner.Row) (*domain.Team, error) {
	team := new(domain.Team)
	var status string
	if err := row.Columns(&team.ProjectID, &team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
		return nil, err
	}
	team.Status = domain.TeamStatus(status)
	return team, nil
}

var _ service.TeamStatements = (*teamStatements)(nil)

var teamSchema = database.NewSchema(map[domain.TeamField]database.FieldBinding[domain.Team]{
	domain.TeamFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(t *domain.Team) any { return t.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.TeamFieldID: {
		SQLName:  "id",
		Accessor: func(t *domain.Team) any { return t.ID },
		Coerce:   database.CoerceString,
	},
	domain.TeamFieldName: {
		SQLName:  "name",
		Accessor: func(t *domain.Team) any { return t.Name },
		Coerce:   database.CoerceString,
	},
	domain.TeamFieldStatus: {
		SQLName:  "status",
		Accessor: func(t *domain.Team) any { return string(t.Status) },
		Coerce:   database.CoerceString,
	},
	domain.TeamFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(t *domain.Team) any { return t.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.TeamFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(t *domain.Team) any { return t.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
