package postgres

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestWrapError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want error
	}{
		{
			name: "nil",
			err:  nil,
			want: nil,
		},
		{
			name: "no rows",
			err:  pgx.ErrNoRows,
			want: new(database.NoRowFoundError),
		},
		{
			name: "too many rows",
			err:  pgx.ErrTooManyRows,
			want: new(database.MultipleRowsFoundError),
		},
		{
			name: "unique violation",
			err:  &pgconn.PgError{Code: "23505", TableName: "projects", ConstraintName: "projects_pkey"},
			want: new(database.UniqueError),
		},
		{
			name: "foreign key violation",
			err:  &pgconn.PgError{Code: "23503", TableName: "projects", ConstraintName: "projects_fk"},
			want: new(database.ForeignKeyError),
		},
		{
			name: "unknown error",
			err:  errors.New("driver exploded"),
			want: new(database.UnknownError),
		},
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
