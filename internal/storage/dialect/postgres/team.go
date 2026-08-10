package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

const (
	createTeamStmt = `INSERT INTO zitadel_nextgen.teams (project_id, id, name) VALUES ($1, $2, $3) RETURNING project_id, id, name, status, created_at, updated_at`
	teamQuery      = `SELECT project_id, id, name, status, created_at, updated_at FROM zitadel_nextgen.teams`
	updateTeamStmt = `UPDATE zitadel_nextgen.teams SET name = $3, updated_at = now() WHERE project_id = $1 AND id = $2 AND status = $4 RETURNING project_id, id, name, status, created_at, updated_at`

	deactivateTeamStmt = `
UPDATE zitadel_nextgen.teams
SET status = $1, updated_at = now()
WHERE project_id = $2 AND id = $3 AND status = $4`

	deactivateTeamMembershipsStmt = `
UPDATE zitadel_nextgen.team_memberships
SET status = $1, updated_at = now()
WHERE project_id = $2 AND team_id = $3 AND status <> $1`

	deactivateTeamOwnedUsersStmt = `
UPDATE zitadel_nextgen.users
SET status = $1, updated_at = now()
WHERE project_id = $2 AND lifecycle_owner_team_id = $3 AND status <> $1`

	deactivateOwnedUsersMembershipsStmt = `
UPDATE zitadel_nextgen.team_memberships
SET status = $1, updated_at = now()
WHERE project_id = $2 AND status <> $1
  AND user_id IN (
    SELECT id FROM zitadel_nextgen.users
    WHERE project_id = $3 AND lifecycle_owner_team_id = $4
  )`
)

type teamStatements struct{ statement }

func newTeamStatements(client queryExecutor) teamStatements {
	return teamStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateTeam implements [service.TeamStatements].
func (ts teamStatements) CreateTeam(ctx context.Context, team *domain.Team) error {
	if err := ensureManagedID(&team.ID, domain.PrefixTeam); err != nil {
		return err
	}
	return withTransaction(ctx, ts.client, func(ctx context.Context, tx queryExecutor) error {
		var status string
		err := tx.QueryRow(ctx, createTeamStmt, team.ProjectID, team.ID, team.Name).
			Scan(&team.ProjectID, &team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt)
		if err != nil {
			return wrapError(err)
		}
		team.Status = domain.TeamStatus(status)
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewTeamResourceScope(team.ProjectID, team.ID))
	})
}

// GetTeamByID implements [service.TeamStatements].
func (ts teamStatements) GetTeamByID(ctx context.Context, projectID, id string) (*domain.Team, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, teamQuery, &database.ListOptions[domain.TeamField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamFieldProjectID), projectID),
			database.Equal(database.Col(domain.TeamFieldID), id),
		),
	}, teamSchema); err != nil {
		return nil, err
	}

	rows, err := ts.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	team, err := pgx.CollectExactlyOneRow(rows, ts.scanTeam)
	if err != nil {
		return nil, wrapError(err)
	}
	return team, nil
}

// UpdateTeam implements [service.TeamStatements].
// The whole team is returned after the update.
// Only active teams are updated.
// Update of a deactivated or a non-existent team returns [database.NoRowFoundError].
func (ts teamStatements) UpdateTeam(ctx context.Context, team *domain.Team) error {
	return wrapError(ts.client.QueryRow(ctx, updateTeamStmt, team.ProjectID, team.ID, team.Name, domain.TeamStatusActive.String()).
		Scan(
			&team.ProjectID,
			&team.ID,
			&team.Name,
			&team.Status,
			&team.CreatedAt,
			&team.UpdatedAt,
		))
}

// ListTeams implements [service.TeamStatements].
func (ts teamStatements) ListTeams(ctx context.Context, filter *database.ListOptions[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, teamQuery, filter, teamSchema); err != nil {
		return nil, err
	}

	rows, err := ts.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	teams, err := pgx.CollectRows(rows, ts.scanTeam)
	if err != nil {
		return nil, wrapError(err)
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

	return withTransaction(ctx, ts.client, func(ctx context.Context, tx queryExecutor) error {
		tag, err := tx.Exec(ctx, deactivateTeamStmt, teamDeactivated, projectID, id, teamActive)
		if err != nil {
			return wrapError(err)
		}
		// No active team: unknown, or already tombstoned.
		if tag.RowsAffected() == 0 {
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
			if _, err := tx.Exec(ctx, step.sql, step.args...); err != nil {
				return wrapError(err)
			}
		}
		edges := newAuthzMembershipEdgeStatements(tx)
		return edges.DeleteAuthzMembershipEdgesForTeamDeactivate(ctx, projectID, id)
	})
}

func (ts teamStatements) scanTeam(row pgx.CollectableRow) (*domain.Team, error) {
	team := new(domain.Team)
	var status string
	if err := row.Scan(&team.ProjectID, &team.ID, &team.Name, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
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
