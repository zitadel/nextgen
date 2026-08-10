//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/database"
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

// drainIncarnation runs ASC+DESC keyset drains and asserts NextCursor emission
// for one List* incarnation. Seed want/filter/orderAsc in the caller; list wraps
// the dialect statement. emissionLimit must be >0 and smaller than len(want).
func drainIncarnation[T any, F ~uint8](
	t *testing.T,
	want []string,
	filter database.Filter[F],
	orderAsc database.OrderBy[F],
	list func(database.Page[F]) (*database.ListResult[T], error),
	id func(T) string,
	emissionLimit uint32,
) {
	t.Helper()
	require.NotEmpty(t, want)
	require.NotEmpty(t, orderAsc.Columns)
	require.Greater(t, emissionLimit, uint32(0))
	require.Less(t, int(emissionLimit), len(want), "emission needs a short trailing page")

	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[F]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[T], error) {
				return list(database.Page[F]{
					Limit:   emissionLimit,
					OrderBy: order,
					Cursor:  cursor,
				})
			}, id)
			assertDrainMatch(t, want, got)
		})
	}

	t.Run("emission", func(t *testing.T) {
		full, err := list(database.Page[F]{Limit: emissionLimit, OrderBy: orderAsc})
		require.NoError(t, err)
		short, err := list(database.Page[F]{
			Limit:   uint32(len(want)),
			OrderBy: orderAsc,
			Cursor:  full.NextCursor,
		})
		require.NoError(t, err)
		assertCursorEmission(t, full, short, emissionLimit)
	})
}
