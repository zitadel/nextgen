package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	createClaimChallengeStmt = `INSERT INTO zitadel_nextgen.claim_challenges (id, project_id, initiating_secret_hash, status, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING created_at`

	getClaimChallengeStmt = `SELECT id, project_id, initiating_secret_hash, status, expires_at, created_at FROM zitadel_nextgen.claim_challenges WHERE id = $1 AND project_id = $2`

	markClaimChallengeCompletedStmt = `UPDATE zitadel_nextgen.claim_challenges SET status = 'completed' WHERE id = $1 AND project_id = $2 AND status = 'pending'`

	// personalTeamForUserStmt resolves the user's personal team without any
	// membership fallback: it picks the user's earliest membership
	// unconditionally (ORDER BY created_at, team_id LIMIT 1) and returns it only
	// when both that membership and its team are active. A deactivated earliest
	// team never falls through to a later membership; zero rows flow to
	// NoRowFoundError.
	personalTeamForUserStmt = `SELECT t.project_id, t.id, t.name, t.status, t.created_at, t.updated_at` +
		` FROM (SELECT project_id, team_id, status FROM zitadel_nextgen.team_memberships` +
		` WHERE project_id = $1 AND user_id = $2` +
		` ORDER BY created_at, team_id LIMIT 1) m` +
		` JOIN zitadel_nextgen.teams t ON t.project_id = m.project_id AND t.id = m.team_id` +
		` WHERE m.status = 'active' AND t.status = 'active'`
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
