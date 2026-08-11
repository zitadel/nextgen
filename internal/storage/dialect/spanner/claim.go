package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	createClaimChallengeStmt = `INSERT INTO claim_challenges (id, project_id, initiating_secret_hash, status, expires_at) VALUES (@p1, @p2, @p3, @p4, @p5) THEN RETURN created_at`

	getClaimChallengeStmt = `SELECT id, project_id, initiating_secret_hash, status, expires_at, created_at FROM claim_challenges WHERE id = @p1 AND project_id = @p2`

	markClaimChallengeCompletedStmt = `UPDATE claim_challenges SET status = 'completed' WHERE id = @p1 AND project_id = @p2 AND status = 'pending'`

	// personalTeamForUserStmt resolves the user's personal team without any
	// membership fallback: it picks the user's earliest membership
	// unconditionally (ORDER BY created_at, team_id LIMIT 1) and returns it only
	// when both that membership and its team are active. A deactivated earliest
	// team never falls through to a later membership; zero rows flow to
	// NoRowFoundError.
	personalTeamForUserStmt = `SELECT t.project_id, t.id, t.name, t.status, t.created_at, t.updated_at` +
		` FROM (SELECT project_id, team_id, status FROM team_memberships` +
		` WHERE project_id = @p1 AND user_id = @p2` +
		` ORDER BY created_at, team_id LIMIT 1) m` +
		` JOIN teams t ON t.project_id = m.project_id AND t.id = m.team_id` +
		` WHERE m.status = 'active' AND t.status = 'active'`
)

type claimStatements struct{ statement }

func newClaimStatements(db queryExecutor) claimStatements {
	return claimStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateChallenge implements [service.ClaimStatements].
func (s claimStatements) CreateChallenge(ctx context.Context, entity *domain.ClaimChallenge) error {
	stmt := buildStatement(createClaimChallengeStmt,
		entity.ID, entity.ProjectID, entity.InitiatingSecretHash, entity.Status.String(), entity.ExpiresAt,
	).statement()
	return s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&entity.CreatedAt)
		})
		return err
	})
}

// GetChallengeByID implements [service.ClaimStatements].
func (s claimStatements) GetChallengeByID(ctx context.Context, projectID, id string) (*domain.ClaimChallenge, error) {
	stmt := buildStatement(getClaimChallengeStmt, id, projectID).statement()
	var challenge *domain.ClaimChallenge
	err := s.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		challenge, err = collectOneRow(iter, scanClaimChallenge)
		return err
	})
	if err != nil {
		return nil, err
	}
	return challenge, nil
}

// MarkChallengeCompleted implements [service.ClaimStatements].
func (s claimStatements) MarkChallengeCompleted(ctx context.Context, projectID, id string) error {
	stmt := buildStatement(markClaimChallengeCompletedStmt, id, projectID).statement()
	n, err := s.db.Update(ctx, stmt)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// GetPersonalTeamForUser implements [service.ClaimStatements].
func (s claimStatements) GetPersonalTeamForUser(ctx context.Context, projectID, userID string) (*domain.Team, error) {
	stmt := buildStatement(personalTeamForUserStmt, projectID, userID).statement()
	var team *domain.Team
	err := s.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		team, err = collectOneRow(iter, newTeamStatements(s.db).scanTeam)
		return err
	})
	if err != nil {
		return nil, err
	}
	return team, nil
}

func scanClaimChallenge(row *spanner.Row) (*domain.ClaimChallenge, error) {
	challenge := new(domain.ClaimChallenge)
	var status string
	if err := row.Columns(
		&challenge.ID,
		&challenge.ProjectID,
		&challenge.InitiatingSecretHash,
		&status,
		&challenge.ExpiresAt,
		&challenge.CreatedAt,
	); err != nil {
		return nil, err
	}
	challenge.Status = domain.ClaimChallengeStatus(status)
	return challenge, nil
}

var _ service.ClaimStatements = (*claimStatements)(nil)
