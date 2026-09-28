package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestWrapError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want error
	}{
		{name: "nil", err: nil, want: nil},
		{name: "no rows", err: sql.ErrNoRows, want: new(database.NoRowFoundError)},
		{name: "too many rows", err: errTooManyRows, want: new(database.MultipleRowsFoundError)},
		{name: "unknown", err: errors.New("boom"), want: new(database.UnknownError)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := wrapError(tt.err)
			if tt.want == nil {
				assert.NoError(t, got)
				return
			}
			require.Error(t, got)
			assert.ErrorIs(t, got, tt.want)
		})
	}
}

func TestWrapErrorConstraintMapping(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	path := filepath.Join(t.TempDir(), "constraints.db")
	pool, err := Config{Path: path}.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })
	require.NoError(t, pool.Migrate(ctx))

	p := pool.(*Pool)
	require.NoError(t, p.CreateProject(ctx, &domain.Project{ID: "proj-1", Name: "one", PreviewOrigins: []string{}}))

	t.Run("primary key maps to UniqueError", func(t *testing.T) {
		err := p.CreateProject(ctx, &domain.Project{ID: "proj-1", Name: "dup", PreviewOrigins: []string{}})
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.UniqueError))
	})

	t.Run("foreign key maps to ForeignKeyError", func(t *testing.T) {
		err := p.CreateTeam(ctx, &domain.Team{ProjectID: "missing", ID: "team-1", Name: "t"})
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
	})
}
