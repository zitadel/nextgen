package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	createClaimChallengeStmt = `INSERT INTO claim_challenges (id, project_id, initiating_secret_hash, status, expires_at, created_at)
VALUES (?, ?, ?, ?, ?, ?)`

	getClaimChallengeStmt = `SELECT id, project_id, initiating_secret_hash, status, expires_at, created_at
FROM claim_challenges WHERE id = ? AND project_id = ?`

	markClaimChallengeCompletedStmt = `UPDATE claim_challenges SET status = 'completed'
WHERE id = ? AND project_id = ? AND status = 'pending'`

	// personalTeamForUserStmt resolves the user's personal team without any
	// membership fallback: it picks the user's earliest membership
	// unconditionally (ORDER BY created_at, team_id LIMIT 1) and returns it only
	// when both that membership and its team are active. A deactivated earliest
	// team never falls through to a later membership; zero rows flow to
	// NoRowFoundError.
	personalTeamForUserStmt = `SELECT t.project_id, t.id, t.name, t.status, t.created_at, t.updated_at
FROM (SELECT project_id, team_id, status FROM team_memberships
      WHERE project_id = ? AND user_id = ?
      ORDER BY created_at, team_id LIMIT 1) m
JOIN teams t ON t.project_id = m.project_id AND t.id = m.team_id
WHERE m.status = 'active' AND t.status = 'active'`
)

type claimStatements struct{ statement }

func newClaimStatements(client queryExecutor) claimStatements {
	return claimStatements{statement: statement{client: client}}
}

// CreateChallenge implements [service.ClaimStatements].
func (s claimStatements) CreateChallenge(ctx context.Context, entity *domain.ClaimChallenge) error {
	now := nowUnixNano()
	_, err := s.client.Exec(ctx, createClaimChallengeStmt,
		entity.ID, entity.ProjectID, entity.InitiatingSecretHash, entity.Status.String(), entity.ExpiresAt.UnixNano(), now,
	)
	if err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(now)
	return nil
}

// GetChallengeByID implements [service.ClaimStatements].
func (s claimStatements) GetChallengeByID(ctx context.Context, projectID, id string) (*domain.ClaimChallenge, error) {
	row := s.client.QueryRow(ctx, getClaimChallengeStmt, id, projectID)
	challenge, err := scanClaimChallengeRow(row)
	if err != nil {
		return nil, wrapError(err)
	}
	return challenge, nil
}

// MarkChallengeCompleted implements [service.ClaimStatements].
func (s claimStatements) MarkChallengeCompleted(ctx context.Context, projectID, id string) error {
	n, err := execAffected(ctx, s.client, markClaimChallengeCompletedStmt, id, projectID)
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
	rows, err := s.client.Query(ctx, personalTeamForUserStmt, projectID, userID)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	team, err := collectExactlyOneRow(rows, scanTeam)
	if err != nil {
		return nil, wrapError(err)
	}
	return team, nil
}

func scanClaimChallengeRow(row *sql.Row) (*domain.ClaimChallenge, error) {
	var (
		challenge   domain.ClaimChallenge
		status      string
		expiresNano int64
		createdNano int64
	)
	if err := row.Scan(
		&challenge.ID, &challenge.ProjectID, &challenge.InitiatingSecretHash,
		&status, &expiresNano, &createdNano,
	); err != nil {
		return nil, err
	}
	challenge.Status = domain.ClaimChallengeStatus(status)
	challenge.ExpiresAt = timeFromUnixNano(expiresNano)
	challenge.CreatedAt = timeFromUnixNano(createdNano)
	return &challenge, nil
}

var _ service.ClaimStatements = (*claimStatements)(nil)
