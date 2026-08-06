//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"crypto/sha256"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
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
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
	return project.ID
}

// seedActiveSessions exchanges n handoffs into sessions that each carry two
// verified factors, so every session spans more than one joined row.
func seedActiveSessions(t *testing.T, stmts service.AllStatements, projectID, userID string, n int) []string {
	t.Helper()
	ids := make([]string, 0, n)
	for range n {
		plain, _ := handoffCompletedAttemptWithUser(t, stmts, projectID, userID)
		session, err := stmts.ExchangeSession(t.Context(), projectID, plain, nil, time.Hour)
		require.NoError(t, err)
		require.Len(t, session.Factors, 2)
		ids = append(ids, session.ID)
	}
	slices.Sort(ids)
	return ids
}

// seedBuildingSessions persists n sessions that have no verified factor.
func seedBuildingSessions(t *testing.T, stmts service.AllStatements, projectID string, n int) []string {
	t.Helper()
	ids := make([]string, 0, n)
	for range n {
		session, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, stmts.CreateSession(t.Context(), session))
		ids = append(ids, session.ID)
	}
	slices.Sort(ids)
	return ids
}

func listSessions(t *testing.T, stmts service.AllStatements, filter database.Filter[domain.SessionField], page database.Page[domain.SessionField]) *database.ListResult[*domain.Session] {
	t.Helper()
	result, err := stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{Filter: filter, Pagination: page})
	require.NoError(t, err)
	return result
}

// walkSessions pages through every session matching filter, asserting that each
// page holds complete sessions, and returns the ids in the order they arrived.
func walkSessions(t *testing.T, stmts service.AllStatements, filter database.Filter[domain.SessionField], page database.Page[domain.SessionField], wantFactors int) []string {
	t.Helper()
	var ids []string
	for pages := 0; ; pages++ {
		require.Less(t, pages, 50, "pagination did not terminate")
		result := listSessions(t, stmts, filter, page)
		for _, session := range result.Items {
			assert.Len(t, session.Factors, wantFactors, "session %s came back with an incomplete factor list", session.ID)
			ids = append(ids, session.ID)
		}
		if len(result.NextCursor) == 0 {
			return ids
		}
		page.Cursor = result.NextCursor
	}
}

func sessionIDs(sessions []*domain.Session) []string {
	ids := make([]string, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, session.ID)
	}
	return ids
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
