package postgres

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// A query the client's cancel interrupts must still name context.Canceled
// after wrapError and a service's domain.ErrInternal: the API logs a client
// that went away at Warn only when the cause survives the wrapping.
func TestWrapErrorKeepsContextCanceled(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	// A server that takes the query and never answers; the client cancels
	// once the query has arrived, so pgx sees the cancel mid-query.
	client, server := net.Pipe()
	t.Cleanup(func() {
		_ = client.Close()
		_ = server.Close()
	})
	go func() {
		_, _ = server.Read(make([]byte, 1024))
		cancel()
		_, _ = io.Copy(io.Discard, server)
	}()
	config, err := pgconn.ParseConfig("postgres://test@localhost/test")
	require.NoError(t, err)
	conn, err := pgconn.Construct(&pgconn.HijackedConn{Conn: client, Config: config})
	require.NoError(t, err)

	_, err = conn.Exec(ctx, "select pg_sleep(60)").ReadAll()
	require.ErrorIs(t, err, context.Canceled, "the precondition: pgx reports the cancel")

	got := domain.ErrInternal(wrapError(err)).WithMessage("failed to query projects")
	require.ErrorIs(t, got, context.Canceled)
}
