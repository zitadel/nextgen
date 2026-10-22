package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestCollectProjectIDs_PagesAcrossCursors(t *testing.T) {
	t.Parallel()

	calls := 0
	list := func(_ context.Context, opts *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
		calls++
		require.Equal(t, uint32(listProjectIDsPageSize), opts.Pagination.Limit)
		switch calls {
		case 1:
			require.Nil(t, opts.Pagination.Cursor)
			return &database.ListResult[*domain.Project]{
				Items: []*domain.Project{
					{ID: "proj_a"},
					{ID: "proj_b"},
				},
				NextCursor: []byte("cursor-page-2"),
			}, nil
		case 2:
			require.Equal(t, []byte("cursor-page-2"), opts.Pagination.Cursor)
			return &database.ListResult[*domain.Project]{
				Items: []*domain.Project{
					{ID: "proj_c"},
				},
			}, nil
		default:
			t.Fatalf("unexpected ListProjects call #%d", calls)
			return nil, nil
		}
	}

	ids, err := collectProjectIDs(t.Context(), list)
	require.NoError(t, err)
	assert.Equal(t, []string{"proj_a", "proj_b", "proj_c"}, ids)
	assert.Equal(t, 2, calls)
}

func TestCollectProjectIDs_SinglePage(t *testing.T) {
	t.Parallel()

	list := func(_ context.Context, opts *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
		require.Nil(t, opts.Pagination.Cursor)
		return &database.ListResult[*domain.Project]{
			Items: []*domain.Project{{ID: "proj_only"}},
		}, nil
	}

	ids, err := collectProjectIDs(t.Context(), list)
	require.NoError(t, err)
	assert.Equal(t, []string{"proj_only"}, ids)
}
