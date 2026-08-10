//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"slices"
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

// assertDrainMatch checks unordered coverage (destructive / mutation cases where
// page order is not the property under test).
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

// drainIncarnation runs ASC+DESC keyset drains and asserts NextCursor emission
// for one List* incarnation. wantAsc must already be in ASC order of orderAsc.
// emissionLimit must be >0 and smaller than len(wantAsc); the short-page check
// asserts the remainder len(wantAsc)-emissionLimit, not merely "shorter than limit".
func drainIncarnation[T any, F ~uint8](
	t *testing.T,
	wantAsc []string,
	orderAsc database.OrderBy[F],
	list func(database.Page[F]) (*database.ListResult[T], error),
	id func(T) string,
	emissionLimit uint32,
) {
	t.Helper()
	require.NotEmpty(t, wantAsc)
	require.NotEmpty(t, orderAsc.Columns)
	require.Greater(t, emissionLimit, uint32(0))
	require.Less(t, int(emissionLimit), len(wantAsc), "emission needs a short trailing page")

	wantDesc := slices.Clone(wantAsc)
	slices.Reverse(wantDesc)

	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[F]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(wantAsc), nil, func(cursor []byte) (*database.ListResult[T], error) {
				return list(database.Page[F]{
					Limit:   emissionLimit,
					OrderBy: order,
					Cursor:  cursor,
				})
			}, id)
			want := wantAsc
			if order.Direction == database.OrderDesc {
				want = wantDesc
			}
			assert.Equal(t, want, got, "paged IDs must follow OrderBy direction")
		})
	}

	t.Run("emission", func(t *testing.T) {
		full, err := list(database.Page[F]{Limit: emissionLimit, OrderBy: orderAsc})
		require.NoError(t, err)
		require.NotNil(t, full)
		require.Equal(t, int(emissionLimit), len(full.Items))
		require.NotEmpty(t, full.NextCursor, "a full page must carry a next cursor")

		short, err := list(database.Page[F]{
			Limit:   uint32(len(wantAsc)),
			OrderBy: orderAsc,
			Cursor:  full.NextCursor,
		})
		require.NoError(t, err)
		require.NotNil(t, short)
		assert.Equal(t, len(wantAsc)-int(emissionLimit), len(short.Items), "short page must be the remainder after the first full page")
		assert.Empty(t, short.NextCursor, "a short page must not carry a next cursor")
	})
}
