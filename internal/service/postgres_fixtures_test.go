//go:build postgres_integration

package service_test

import (
	"crypto/sha256"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func ensureProject(t *testing.T, pool database.QueryExecutor, projectID string) {
	t.Helper()
	// name is NOT NULL; derive it from the project ID
	_, err := pool.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.projects (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
		projectID, "project-"+projectID,
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
	v2 := integrationV2PoolOrFail(t)

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
	require.NoError(t, v2.Statements().CreateAuthAttempt(t.Context(), attempt))
	attempt.HandoffToken = handoffTokenForIntegration(plainToken)
	require.NoError(t, v2.Statements().HandoffAuthAttempt(t.Context(), attempt))
	return plainToken, attempt
}

func sessionFactorsByType(session *domain.Session) map[domain.AuthCheckType]domain.AuthFactor {
	out := make(map[domain.AuthCheckType]domain.AuthFactor, len(session.Factors))
	for _, f := range session.Factors {
		out[f.Type()] = f
	}
	return out
}
