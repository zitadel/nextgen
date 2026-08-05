//go:build spanner_integration

package spanner

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// TestListSessions_pagesMoreAnonymousSessionsThanFitOnAPage is the Spanner peer
// of the SQLite and Postgres tests with the same name. It pages a list ordered
// by user_id, which is NULL until a factor is verified, with the NULL block
// wider than one page so the cursor has to carry a NULL forward. Every session
// must come back exactly once.
func TestListSessions_pagesMoreAnonymousSessionsThanFitOnAPage(t *testing.T) {
	ctx := t.Context()
	projectID := uniqueProjectID(t)
	require.NoError(t, testClient.CreateProject(ctx, newTestProject(projectID)))
	t.Cleanup(func() { _ = testClient.DeleteProjectByID(context.Background(), projectID) })

	want := []string{
		createFactorFreeSession(t, projectID),
		createFactorFreeSession(t, projectID),
		createFactorFreeSession(t, projectID),
	}

	var (
		got    []string
		cursor []byte
	)
	for page := 0; page <= len(want); page++ {
		result, listErr := testClient.ListSessions(ctx, &database.ListOptions[domain.SessionField]{
			Filter: database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
			Pagination: database.Page[domain.SessionField]{
				Limit: 2,
				OrderBy: database.OrderBy[domain.SessionField]{
					// id is the tiebreaker. user_id is not unique across a
					// user's sessions, so it cannot order the page on its own.
					Columns: []database.Column[domain.SessionField]{
						database.Col(domain.SessionFieldUserID),
						database.Col(domain.SessionFieldID),
					},
					Direction: database.OrderAsc,
				},
				Cursor: cursor,
			},
		})
		require.NoError(t, listErr)

		for _, session := range result.Items {
			got = append(got, session.ID)
		}
		if len(result.NextCursor) == 0 {
			break
		}
		cursor = result.NextCursor
		require.NotEqual(t, len(want), page, "paging did not terminate")
	}

	assert.ElementsMatch(t, want, got, "every session must appear exactly once across all pages")
}

// createFactorFreeSession stores a session with no verified checks, so it is a
// single row in the checks LEFT JOIN and the page limit counts sessions rather
// than joined rows.
func createFactorFreeSession(t *testing.T, projectID string) string {
	t.Helper()
	session, err := domain.NewSession(projectID, nil)
	require.NoError(t, err)
	require.NoError(t, testClient.CreateSession(t.Context(), session))
	return session.ID
}