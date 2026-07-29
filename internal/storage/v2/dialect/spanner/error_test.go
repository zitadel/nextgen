package spanner

import (
	"errors"
	"testing"

	"cloud.google.com/go/spanner"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/zitadel/nextgen/internal/domain"
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
			name: "row not found",
			err:  spanner.ErrRowNotFound,
			want: new(database.NoRowFoundError),
		},
		{
			name: "too many rows",
			err:  errTooManyRows,
			want: new(database.MultipleRowsFoundError),
		},
		{
			name: "grpc not found",
			err:  status.Error(codes.NotFound, "row not found"),
			want: new(database.NoRowFoundError),
		},
		{
			name: "grpc already exists",
			err:  status.Error(codes.AlreadyExists, "duplicate"),
			want: new(database.UniqueError),
		},
		{
			name: "grpc failed precondition",
			err:  status.Error(codes.FailedPrecondition, "check failed"),
			want: new(database.CheckError),
		},
		{
			name: "unknown error",
			err:  errors.New("driver exploded"),
			want: new(database.UnknownError),
		},
		{
			name: "preserves domain error",
			err:  domain.ErrNotImplemented(),
			want: domain.ErrNotImplemented(),
		},
		{
			name: "preserves unimplemented error",
			err:  database.NewUnimplementedError(nil),
			want: new(database.UnimplementedError),
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
