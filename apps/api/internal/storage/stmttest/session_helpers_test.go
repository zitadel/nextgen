//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// handoffCompletedAttempt creates a completed auth attempt (password factor)
// and persists a handoff token. Returns the plain handoff token and attempt.
func handoffCompletedAttempt(t *testing.T, stmts service.AllStatements, projectID string, mutate func(*domain.AuthAttempt)) (plainToken string, attempt *domain.AuthAttempt) {
	t.Helper()
	plainToken = "handoff_" + uniqueSuffix(t)
	attempt = &domain.AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
	}
	if mutate != nil {
		mutate(attempt)
	}
	require.NoError(t, stmts.CreateAuthAttempt(t.Context(), attempt))
	sum := sha256.Sum256([]byte(plainToken))
	attempt.HandoffToken = &domain.HandoffToken{TokenHash: sum[:]}
	require.NoError(t, stmts.HandoffAuthAttempt(t.Context(), attempt))
	t.Cleanup(func() {
		_ = stmts.DeleteAuthAttemptByID(context.Background(), projectID, attempt.ID)
	})
	return plainToken, attempt
}

// handoffCompletedAttemptWithUser creates a completed attempt with verified
// user + password factors so ExchangeSession binds the session to userID.
func handoffCompletedAttemptWithUser(t *testing.T, stmts service.AllStatements, projectID, userID string) (plainToken string, attempt *domain.AuthAttempt) {
	t.Helper()
	return handoffCompletedAttempt(t, stmts, projectID, func(a *domain.AuthAttempt) {
		a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}
		a.Checks = []domain.AuthCheck{
			&domain.AuthFactorUser{UserID: userID},
			&domain.AuthFactorPassword{},
		}
	})
}

func ensureProject(t *testing.T, stmts service.AllStatements) string {
	t.Helper()
	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
	return project.ID
}

func newMissingHandoffAttempt(projectID string) *domain.AuthAttempt {
	sum := sha256.Sum256([]byte("missing-handoff-" + time.Now().Format(time.RFC3339Nano)))
	return &domain.AuthAttempt{
		ID:        "999999999",
		ProjectID: projectID,
		HandoffToken: &domain.HandoffToken{
			TokenHash: sum[:],
		},
	}
}
