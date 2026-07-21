package spanner

import (
	"context"
	"errors"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const (
	teamsTable     = "teams"
	createTeamStmt = `INSERT INTO teams (project_id, id) VALUES (@p1, @p2) THEN RETURN project_id, id, status, created_at, updated_at`
	teamQuery      = `SELECT project_id, id, status, created_at, updated_at FROM teams`

	deactivateTeamStmt                  = `UPDATE teams SET status = @p1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p2 AND id = @p3`
	deactivateTeamMembershipsStmt       = `UPDATE team_memberships SET status = @p1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p2 AND team_id = @p3 AND status <> @p1`
	deactivateTeamOwnedUsersStmt        = `UPDATE users SET status = @p1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p2 AND lifecycle_owner_team_id = @p3 AND status <> @p1`
	deactivateOwnedUsersMembershipsStmt = `UPDATE team_memberships SET status = @p1, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p2 AND status <> @p1 AND user_id IN (SELECT id FROM users WHERE project_id = @p3 AND lifecycle_owner_team_id = @p4)`
)

var teamColumns = []string{
	"project_id", "id", "status", "created_at", "updated_at",
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
	if team.ID == "" {
		return errors.New("team ID must not be empty")
	}
	stmt := buildStatement(createTeamStmt, team.ProjectID, team.ID).statement()
	return ts.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			var status string
			if err := row.Columns(&team.ProjectID, &team.ID, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
				return struct{}{}, err
			}
			team.Status = domain.TeamStatus(status)
			return struct{}{}, nil
		})
		return err
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

// DeactivateTeam implements [service.TeamStatements].
func (ts teamStatements) DeactivateTeam(ctx context.Context, projectID, id string) error {
	membershipRemoved := domain.MembershipStatusRemoved.String()
	userDeactivated := domain.UserStatusDeactivated.String()
	teamDeactivated := domain.TeamStatusDeactivated.String()

	if _, err := ts.db.Update(ctx, buildStatement(deactivateTeamStmt, teamDeactivated, projectID, id).statement()); err != nil {
		return err
	}
	// Remove roster access to this team for all participants (self-owned and team-owned).
	if _, err := ts.db.Update(ctx, buildStatement(deactivateTeamMembershipsStmt, membershipRemoved, projectID, id).statement()); err != nil {
		return err
	}
	// Deactivate users lifecycle-owned by this team (ADR 024).
	if _, err := ts.db.Update(ctx, buildStatement(deactivateTeamOwnedUsersStmt, userDeactivated, projectID, id).statement()); err != nil {
		return err
	}
	// Match UserRepository.Deactivate: deprovisioned users lose all memberships/access,
	// including roster rows on other teams.
	if _, err := ts.db.Update(ctx, buildStatement(deactivateOwnedUsersMembershipsStmt, membershipRemoved, projectID, projectID, id).statement()); err != nil {
		return err
	}
	return nil
}

func (ts teamStatements) scanTeam(row *spanner.Row) (*domain.Team, error) {
	team := new(domain.Team)
	var status string
	if err := row.Columns(&team.ProjectID, &team.ID, &status, &team.CreatedAt, &team.UpdatedAt); err != nil {
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
