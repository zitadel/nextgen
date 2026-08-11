package spanner

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"cloud.google.com/go/spanner"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

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
			name: "grpc aborted after retries are spent",
			err:  status.Error(codes.Aborted, "Transaction: 1 aborted due to another transaction getting priority."),
			want: new(database.UnavailableError),
		},
		{
			name: "grpc deadline exceeded",
			err:  status.Error(codes.DeadlineExceeded, "context deadline exceeded"),
			want: new(database.UnavailableError),
		},
		{
			// What the retry budget actually produces: it usually expires while
			// gax is backing off between aborts, and gax.Sleep returns ctx.Err()
			// with no gRPC status attached.
			name: "bare context deadline exceeded",
			err:  fmt.Errorf("giving up: %w", context.DeadlineExceeded),
			want: new(database.UnavailableError),
		},
		{
			name: "grpc unavailable",
			err:  status.Error(codes.Unavailable, "backend unavailable"),
			want: new(database.UnavailableError),
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

func TestBoundRetry(t *testing.T) {
	t.Parallel()

	t.Run("applies a default deadline when ctx has none", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := boundRetry(t.Context())
		defer cancel()

		deadline, ok := ctx.Deadline()
		require.True(t, ok, "an unbounded conflict loop would spin forever")
		// retryBudget, not maxRetryDuration: under -tags spanner_integration
		// TestMain sets SPANNER_EMULATOR_HOST, which selects the looser bound.
		// Which value each environment gets is pinned by TestRetryBudget.
		assert.WithinDuration(t, time.Now().Add(retryBudget()), deadline, time.Second)
	})

	t.Run("keeps a deadline the caller already set", func(t *testing.T) {
		t.Parallel()

		want := time.Now().Add(time.Hour)
		outer, cancelOuter := context.WithDeadline(t.Context(), want)
		defer cancelOuter()

		ctx, cancel := boundRetry(outer)
		defer cancel()

		got, ok := ctx.Deadline()
		require.True(t, ok)
		assert.Equal(t, want, got, "a caller's own deadline must win")
	})
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

// TestRetryBudget cannot be parallel: t.Setenv forbids it, and the branch under
// test is selected by process environment.
func TestRetryBudget(t *testing.T) {
	t.Setenv("SPANNER_EMULATOR_HOST", "")
	assert.Equal(t, maxRetryDuration, retryBudget(),
		"production must keep the tight bound; a hot row should fail fast")

	t.Setenv("SPANNER_EMULATOR_HOST", "localhost:9010")
	assert.Equal(t, emulatorRetryDuration, retryBudget(),
		"the emulator serialises transactions process-wide and starves long ones, "+
			"so the production bound turns test contention into a failed request")
}

// runBounded must report a spent budget. Without it the only trace is a
// request's wall-clock duration, which is how the #794 CI failure had to be
// diagnosed.
func TestRunBounded(t *testing.T) {
	t.Parallel()

	t.Run("passes a successful call through untouched", func(t *testing.T) {
		t.Parallel()

		var gotDeadline bool
		err := runBounded(t.Context(), func(ctx context.Context) error {
			_, gotDeadline = ctx.Deadline()
			return nil
		})

		require.NoError(t, err)
		assert.True(t, gotDeadline, "the callback must run under the retry budget")
	})

	t.Run("returns the callback error and leaves it unwrapped", func(t *testing.T) {
		t.Parallel()

		want := errors.New("callback failed")
		got := runBounded(t.Context(), func(context.Context) error { return want })

		assert.ErrorIs(t, got, want, "wrapping here would hide the status from the retry loop")
	})

	t.Run("keeps a deadline the caller already set", func(t *testing.T) {
		t.Parallel()

		want := time.Now().Add(time.Hour)
		outer, cancelOuter := context.WithDeadline(t.Context(), want)
		defer cancelOuter()

		var got time.Time
		require.NoError(t, runBounded(outer, func(ctx context.Context) error {
			got, _ = ctx.Deadline()
			return nil
		}))
		assert.Equal(t, want, got)
	})
}
