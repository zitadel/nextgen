//go:build integration

package service_test

import (
	"crypto/sha256"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func ensureProject(t *testing.T, pool database.QueryExecutor, projectID string) {
	t.Helper()
	_, err := pool.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.projects (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
		projectID,
	)
	require.NoError(t, err)
}

func handoffTokenForIntegration(plain string) *domain.HandoffToken {
	sum := sha256.Sum256([]byte(plain))
	return &domain.HandoffToken{TokenHash: sum[:]}
}

func handoffCompletedAttempt(
	t *testing.T,
	pool database.QueryExecutor,
	projectID string,
	mutate func(*domain.AuthAttempt),
) (plainToken string, attempt *domain.AuthAttempt) {
	t.Helper()
	authRepo := repository.NewAuthAttemptRepository(pool)

	plainToken = "handoff_" + projectID + "_" + time.Now().Format("150405.000000")
	attempt = &domain.AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypePassword},
		Checks:         []domain.AuthCheck{&domain.AuthFactorPassword{}},
	}
	if mutate != nil {
		mutate(attempt)
	}
	ensureProject(t, pool, projectID)
	require.NoError(t, authRepo.Create(t.Context(), pool, attempt))
	attempt.HandoffToken = handoffTokenForIntegration(plainToken)
	require.NoError(t, authRepo.Handoff(t.Context(), pool, attempt))
	return plainToken, attempt
}

func sessionFactorsByType(session *domain.Session) map[domain.AuthCheckType]domain.AuthFactor {
	out := make(map[domain.AuthCheckType]domain.AuthFactor, len(session.Factors))
	for _, f := range session.Factors {
		out[f.Type()] = f
	}
	return out
}
