//go:build postgres_integration

package service_test

import (
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func ensureProject(t *testing.T, projectID string) {
	t.Helper()
	pool := integrationPoolOrFail(t)
	err := pool.Statements().CreateProject(t.Context(), &domain.Project{
		ID:             projectID,
		Name:           "project-" + projectID,
		PreviewOrigins: []string{},
	})
	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return
		}
		require.NoError(t, err)
	}
}

func handoffTokenForIntegration(plain string) *domain.HandoffToken {
	sum := sha256.Sum256([]byte(plain))
	return &domain.HandoffToken{TokenHash: sum[:]}
}

func handoffCompletedAttempt(
	t *testing.T,
	projectID string,
	mutate func(*domain.AuthAttempt),
) (plainToken string, attempt *domain.AuthAttempt) {
	t.Helper()
	pool := integrationPoolOrFail(t)

	plainToken = "handoff_" + projectID + "_" + time.Now().Format("150405.000000")
	attempt = &domain.AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
	}
	if mutate != nil {
		mutate(attempt)
	}
	ensureProject(t, projectID)
	require.NoError(t, pool.Statements().CreateAuthAttempt(t.Context(), attempt))
	attempt.HandoffToken = handoffTokenForIntegration(plainToken)
	require.NoError(t, pool.Statements().HandoffAuthAttempt(t.Context(), attempt))
	return plainToken, attempt
}

func sessionFactorsByType(session *domain.Session) map[domain.AuthCheckType]domain.AuthFactor {
	out := make(map[domain.AuthCheckType]domain.AuthFactor, len(session.Factors))
	for _, f := range session.Factors {
		out[f.Type()] = f
	}
	return out
}
