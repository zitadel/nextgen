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
			name: "grpc failed precondition column width",
			err:  status.Error(codes.FailedPrecondition, "New value exceeds the maximum size limit for this column: teams.name, size: 201, limit: 200."),
			want: new(database.CheckError),
		},
		{
			name: "grpc failed precondition foreign key",
			err:  status.Error(codes.FailedPrecondition, "Foreign key `fk_user_passwords_user` constraint violation on table `user_passwords`"),
			want: new(database.ForeignKeyError),
		},
		{
			name: "grpc failed precondition unique",
			err:  status.Error(codes.FailedPrecondition, "Unique index violation on index projects_pkey"),
			want: new(database.UniqueError),
		},
		{
			name: "grpc failed precondition not null",
			err:  status.Error(codes.FailedPrecondition, "NOT NULL constraint violated"),
			want: new(database.NotNullError),
		},
		{
			name: "grpc failed precondition null value",
			err:  status.Error(codes.FailedPrecondition, "Cannot specify a null value for column: teams.name in table: teams"),
			want: new(database.NotNullError),
		},
		{
			name: "grpc invalid argument foreign key",
			err:  status.Error(codes.InvalidArgument, "foreign key constraint violation"),
			want: new(database.ForeignKeyError),
		},
		{
			name: "grpc invalid argument syntax error",
			err:  status.Error(codes.InvalidArgument, `Syntax error: Unexpected identifier "SELCT" [at 1:1]`),
			want: new(database.UnknownError),
		},
		{
			name: "grpc out of range check",
			err:  status.Error(codes.OutOfRange, "Check constraint `teams`.`chk_teams_name` is violated for key {String(\"proj_1\"), String(\"team_1\")}"),
			want: new(database.CheckError),
		},
		{
			name: "grpc out of range division by zero",
			err:  status.Error(codes.OutOfRange, "division by zero: 1 / 0"),
			want: new(database.UnknownError),
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

// ReadWriteTransaction retries an aborted transaction only while it can still
// find the ABORTED status in the error the callback returned, so wrapError must
// stay transparent to it. See #788.
func TestWrapErrorKeepsAbortedRetryable(t *testing.T) {
	t.Parallel()

	got := wrapError(spanner.ToSpannerError(status.Error(codes.Aborted,
		"Transaction: 1 aborted due to another transaction getting priority.")))

	require.Error(t, got)
	assert.Equal(t, codes.Aborted, status.Code(got),
		"ABORTED was stripped; ReadWriteTransaction will not retry")
	assert.ErrorAs(t, got, new(*spanner.Error))
}
