//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// TestSessionStatements_DeleteSessions_FilterLimit deletes expired sessions by
// filter (not list-then-DeleteByID) and respects Limit.
func TestSessionStatements_DeleteSessions_FilterLimit(t *testing.T) {
	forEachDialectAlone(t, func(t *testing.T, d dialect) {
		projectID := uniqueProjectID(t)
		require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(projectID)))
		t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), projectID) })

		expired := make([]*domain.Session, 0, 3)
		for i := 0; i < 3; i++ {
			session, err := domain.NewSession(projectID, nil)
			require.NoError(t, err)
			session.TimeToLive = time.Nanosecond
			require.NoError(t, d.stmts.CreateSession(t.Context(), session))
			expired = append(expired, session)
		}
		live, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		live.TimeToLive = time.Hour
		require.NoError(t, d.stmts.CreateSession(t.Context(), live))

		time.Sleep(5 * time.Millisecond)

		deleted, err := d.stmts.DeleteSessions(t.Context(), &database.ListOptions[domain.SessionField]{
			Filter: database.LessThan(database.Col(domain.SessionFieldExpiresAt), time.Now().UTC()),
			Pagination: database.Page[domain.SessionField]{
				Limit: 2,
				OrderBy: database.OrderBy[domain.SessionField]{
					Columns: []database.Column[domain.SessionField]{
						database.Col(domain.SessionFieldExpiresAt),
						database.Col(domain.SessionFieldID),
					},
				},
			},
		})
		require.NoError(t, err)
		require.Len(t, deleted, 2)

		_, err = d.stmts.GetSessionByID(t.Context(), projectID, live.ID)
		require.NoError(t, err, "unexpired session must remain")

		remainingExpired := 0
		for _, s := range expired {
			_, err := d.stmts.GetSessionByID(t.Context(), projectID, s.ID)
			if err != nil {
				require.ErrorIs(t, err, domain.ErrSessionNotFound())
				continue
			}
			remainingExpired++
		}
		assert.Equal(t, 1, remainingExpired, "limit 2 of 3 expired should leave one")
	})
}
