package repository

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type AuthAttempt struct{}

// AddChallenge implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) AddChallenge(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, challenge *domain.Challenge) error {
	panic("unimplemented")
}

// Complete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Complete(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string) error {
	panic("unimplemented")
}

// Create implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Create(ctx context.Context, client database.QueryExecutor, authAttempt *domain.AuthAttempt) error {
	panic("unimplemented")
}

// Delete implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Delete(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string) error {
	panic("unimplemented")
}

// Get implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Get(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string) (attempt *domain.AuthAttempt, err error) {
	attempt = new(domain.AuthAttempt)
	err = client.QueryRow(ctx, "SELECT auth_attempt.project_id, auth_attempt.id FROM auth_attempts WHERE project_id = $1 AND id = $2").Scan(
		&attempt.ProjectID,
		&attempt.ID,
	)
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

// Handoff implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Handoff(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, sessionID string) error {
	panic("unimplemented")
}

// Update implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) Update(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string) {
	panic("unimplemented")
}

// VerifyChallenge implements [domain.AuthAttemptRepository].
func (a *AuthAttempt) VerifyChallenge(ctx context.Context, client database.QueryExecutor, projectID string, authAttemptID string, challengeID string, success bool) error {
	panic("unimplemented")
}

var _ domain.AuthAttemptRepository = (*AuthAttempt)(nil)
