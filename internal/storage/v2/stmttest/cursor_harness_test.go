//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// pageAll drains list pages until NextCursor is empty. wantLen caps the page
// loop so a broken keyset cannot hang the suite. startCursor seeds the first
// request (nil starts from the beginning).
func pageAll[T any](
	t *testing.T,
	wantLen int,
	startCursor []byte,
	list func(cursor []byte) (*database.ListResult[T], error),
	id func(T) string,
) []string {
	t.Helper()

	var got []string
	cursor := startCursor
	for pages := 0; ; pages++ {
		require.LessOrEqual(t, pages, wantLen, "paging did not terminate")
		result, err := list(cursor)
		require.NoError(t, err)
		require.NotNil(t, result)
		for _, item := range result.Items {
			got = append(got, id(item))
		}
		if len(result.NextCursor) == 0 {
			return got
		}
		cursor = result.NextCursor
	}
}

func assertDrainMatch(t *testing.T, want, got []string) {
	t.Helper()
	assert.ElementsMatch(t, want, got, "every seeded row must appear exactly once across pages")
	assert.Equal(t, len(want), len(got), "duplicate IDs would inflate got length")
}

func assertDatabaseErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	require.Error(t, err)
	var dbErr database.Error
	require.ErrorAs(t, err, &dbErr)
	assert.Equal(t, code, dbErr.Code)
}

// assertCursorEmission checks full-page vs short-page NextCursor rules.
func assertCursorEmission[T any](
	t *testing.T,
	fullPage *database.ListResult[T],
	shortPage *database.ListResult[T],
	limit uint32,
) {
	t.Helper()
	require.NotNil(t, fullPage)
	require.NotNil(t, shortPage)
	require.Equal(t, int(limit), len(fullPage.Items))
	assert.NotEmpty(t, fullPage.NextCursor, "a full page must carry a next cursor")
	assert.Less(t, len(shortPage.Items), int(limit))
	assert.Empty(t, shortPage.NextCursor, "a short page must not carry a next cursor")
}
