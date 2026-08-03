package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

const (
	createClaimChallengeStmt = `INSERT INTO zitadel_nextgen.claim_challenges (id, project_id, initiating_secret_hash, status, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING created_at`

	getClaimChallengeStmt = `SELECT id, project_id, initiating_secret_hash, status, expires_at, created_at FROM zitadel_nextgen.claim_challenges WHERE id = $1 AND project_id = $2`

	markClaimChallengeCompletedStmt = `UPDATE zitadel_nextgen.claim_challenges SET status = 'completed' WHERE id = $1 AND project_id = $2 AND status = 'pending'`

	// personalTeamForUserStmt resolves the user's personal team: the earliest
	// active membership joined to an active team (ORDER BY m.created_at, m.team_id).
	personalTeamForUserStmt = `SELECT t.project_id, t.id, t.name, t.status, t.created_at, t.updated_at` +
		` FROM zitadel_nextgen.teams t` +
		` JOIN zitadel_nextgen.team_memberships m ON m.project_id = t.project_id AND m.team_id = t.id` +
		` WHERE m.project_id = $1 AND m.user_id = $2 AND m.status = 'active' AND t.status = 'active'` +
		` ORDER BY m.created_at, m.team_id LIMIT 1`
)

type claimStatements struct{ statement }

func newClaimStatements(client queryExecutor) claimStatements {
	return claimStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateChallenge implements [service.ClaimStatements].
func (s claimStatements) CreateChallenge(ctx context.Context, entity *domain.ClaimChallenge) error {
	err := s.client.QueryRow(ctx, createClaimChallengeStmt,
		entity.ID, entity.ProjectID, entity.InitiatingSecretHash, entity.Status.String(), entity.ExpiresAt,
	).Scan(&entity.CreatedAt)
	if err != nil {
		return wrapError(err)
	}
	return nil
}

// GetChallengeByID implements [service.ClaimStatements].
func (s claimStatements) GetChallengeByID(ctx context.Context, projectID, id string) (*domain.ClaimChallenge, error) {
	rows, err := s.client.Query(ctx, getClaimChallengeStmt, id, projectID)
	if err != nil {
		return nil, wrapError(err)
	}
	challenge, err := pgx.CollectExactlyOneRow(rows, scanClaimChallenge)
	if err != nil {
		return nil, wrapError(err)
	}
	return challenge, nil
}

// MarkChallengeCompleted implements [service.ClaimStatements].
func (s claimStatements) MarkChallengeCompleted(ctx context.Context, projectID, id string) error {
	tag, err := s.client.Exec(ctx, markClaimChallengeCompletedStmt, id, projectID)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// GetPersonalTeamForUser implements [service.ClaimStatements].
func (s claimStatements) GetPersonalTeamForUser(ctx context.Context, projectID, userID string) (*domain.Team, error) {
	rows, err := s.client.Query(ctx, personalTeamForUserStmt, projectID, userID)
	if err != nil {
		return nil, wrapError(err)
	}
	team, err := pgx.CollectExactlyOneRow(rows, newTeamStatements(s.client).scanTeam)
	if err != nil {
		return nil, wrapError(err)
	}
	return team, nil
}

func scanClaimChallenge(row pgx.CollectableRow) (*domain.ClaimChallenge, error) {
	challenge := new(domain.ClaimChallenge)
	var status string
	if err := row.Scan(
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
