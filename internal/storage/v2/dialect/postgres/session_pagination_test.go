//go:build postgres_integration

package postgres

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// TestListSessions_pagesAnonymousSessionsWhenSortingByUserID pages the whole
// list ordered by user_id, which is NULL until a factor is verified. Every
// session must come back exactly once.
//
// Two things have to agree for that to hold, and on Postgres they do not.
// compare.CompileNullAware documents an assumption of ASC NULLS FIRST, but
// neither compileOrderBy emits a NULLS clause, so Postgres applies its own
// default of NULLS LAST. Separately, the SessionFieldUserID binding in
// sessionSchema hands the cursor "" for a nil UserID, so the keyset predicate
// never takes the null-aware path at all.
func TestListSessions_pagesAnonymousSessionsWhenSortingByUserID(t *testing.T) {
	ctx := t.Context()
	projectID := uniqueSessionFixtureIDs(t)
	ensureSessionProject(t, projectID)

	schemaURL := "https://schemas.test/session-pagination/v1.json"
	_, err := testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3::json)`,
		projectID, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = testPool.pool.Exec(cleanupCtx, `DELETE FROM zitadel_nextgen.sessions WHERE project_id = $1`, projectID)
		_, _ = testPool.pool.Exec(cleanupCtx, `DELETE FROM zitadel_nextgen.users WHERE project_id = $1`, projectID)
		_, _ = testPool.pool.Exec(cleanupCtx, `DELETE FROM zitadel_nextgen.json_schemas WHERE project_id = $1`, projectID)
	})

	want := []string{
		createFactorFreeSession(t, projectID),
		createFactorFreeSession(t, projectID),
	}
	for _, userID := range []string{"usr-a-" + projectID, "usr-b-" + projectID} {
		_, err = testPool.pool.Exec(ctx,
			`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, status) VALUES ($1, $2, $3, $4)`,
			projectID, schemaURL, userID, domain.UserStatusActive.String(),
		)
		require.NoError(t, err)

		sessionID := createFactorFreeSession(t, projectID)
		_, err = testPool.pool.Exec(ctx,
			`UPDATE zitadel_nextgen.sessions SET user_id = $1 WHERE project_id = $2 AND id = $3`,
			userID, projectID, sessionID,
		)
		require.NoError(t, err)
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
