//go:build sqlite_integration

package sqlite

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// TestListSessions_pagesAnonymousSessionsWhenSortingByUserID is the SQLite peer
// of the Postgres test with the same name. It pages the whole list ordered by
// user_id, which is NULL until a factor is verified, and every session must come
// back exactly once.
//
// SQLite sorts NULLs first on ASC, which is what compare.CompileNullAware
// assumes, so the anonymous sessions land on the first page and are returned
// before the cursor moves past them. Postgres sorts them last and loses them.
func TestListSessions_pagesAnonymousSessionsWhenSortingByUserID(t *testing.T) {
	ctx := t.Context()
	projectID := "proj-session-paging-" + uniqueSuffix(t)
	require.NoError(t, testPool.CreateProject(ctx, &domain.Project{ID: projectID, Name: "s"}))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	want := []string{
		createFactorFreeSession(t, projectID),
		createFactorFreeSession(t, projectID),
	}
	for _, userID := range []string{"usr-a-" + projectID, "usr-b-" + projectID} {
		ensureTestUser(t, projectID, userID)

		sessionID := createFactorFreeSession(t, projectID)
		require.NoError(t, testPool.UpdateSessionAfterExchange(ctx, projectID, sessionID, &userID, domain.SessionAnonymousTTL))
		want = append(want, sessionID)
	}

	var (
		got    []string
		cursor []byte
	)
	for page := 0; page <= len(want); page++ {
		result, listErr := testPool.ListSessions(ctx, &database.ListOptions[domain.SessionField]{
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

// TestListSessions_pagesMoreAnonymousSessionsThanFitOnAPage is the same walk
// with three anonymous sessions and a page size of two, so the NULL block spans
// a page boundary and the cursor has to carry a NULL forward.
func TestListSessions_pagesMoreAnonymousSessionsThanFitOnAPage(t *testing.T) {
	ctx := t.Context()
	projectID := "proj-session-paging-" + uniqueSuffix(t)
	require.NoError(t, testPool.CreateProject(ctx, &domain.Project{ID: projectID, Name: "s"}))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

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
		result, listErr := testPool.ListSessions(ctx, &database.ListOptions[domain.SessionField]{
			Filter: database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
			Pagination: database.Page[domain.SessionField]{
				Limit: 2,
				OrderBy: database.OrderBy[domain.SessionField]{
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
	require.NoError(t, testPool.CreateSession(t.Context(), session))
	return session.ID
}
