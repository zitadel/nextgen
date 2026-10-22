package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

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

// A query the client's cancel interrupts must still name context.Canceled
// after wrapError: the API logs a client that went away at Warn only when the
// cause survives the wrapping.
func TestWrapErrorKeepsContextCanceled(t *testing.T) {
	t.Parallel()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "cancel.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	conn, err := db.Conn(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })

	// A query that never ends on its own, canceled while the driver runs it.
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	time.AfterFunc(50*time.Millisecond, cancel)
	var n int64
	err = conn.QueryRowContext(ctx, `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c`).Scan(&n)
	require.Error(t, err)

	got := domain.ErrInternal(wrapError(err)).WithMessage("failed to query projects")
	require.ErrorIs(t, got, context.Canceled)
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
	require.NoError(t, p.CreateProject(ctx, &domain.Project{ID: "proj-1", Name: "one", Origins: []domain.Origin{}}))

	t.Run("primary key maps to UniqueError", func(t *testing.T) {
		err := p.CreateProject(ctx, &domain.Project{ID: "proj-1", Name: "dup", Origins: []domain.Origin{}})
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.UniqueError))
	})

	t.Run("foreign key maps to ForeignKeyError", func(t *testing.T) {
		err := p.CreateTeam(ctx, &domain.Team{ProjectID: "missing", ID: "team-1", Name: "t"})
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
	})
}
