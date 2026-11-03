package spanner

import (
	"context"
	"errors"
	"strings"

	"cloud.google.com/go/spanner"
	"google.golang.org/grpc/codes"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var errTooManyRows = errors.New("spanner: multiple rows in result set")

func wrapError(err error) error {
	if err == nil {
		return nil
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if unimplemented, ok := errors.AsType[*database.UnimplementedError](err); ok {
		return unimplemented
	}
	if errors.Is(err, spanner.ErrRowNotFound) {
		return database.NewNoRowFoundError(err)
	}
	if errors.Is(err, errTooManyRows) {
		return database.NewMultipleRowsFoundError(err)
	}
	// The retry budget usually runs out while the client is backing off between
	// aborts, and gax.Sleep returns the bare context error, which carries no gRPC
	// status for the switch below to classify. This is the common shape of an
	// exhausted budget, not an edge case.
	if errors.Is(err, context.DeadlineExceeded) {
		return database.NewUnavailableError(err)
	}

	switch spanner.ErrCode(err) {
	// Retry is already exhausted by the time these arrive here:
	// ReadWriteTransaction retries ABORTED internally until the budget set by
	// [runBounded] runs out, and returns the last status (or the context error)
	// only once it has given up. Classifying them keeps the caller from
	// reporting a transient conflict as an unexplained internal failure.
	case codes.Aborted, codes.DeadlineExceeded, codes.Unavailable:
		return database.NewUnavailableError(err)
	case codes.NotFound:
		return database.NewNoRowFoundError(err)
	case codes.AlreadyExists:
		return database.NewUniqueError("", "", err)
	// A violated CHECK arrives as OutOfRange, which Spanner also returns for
	// ordinary query failures like a division by zero.
	case codes.FailedPrecondition, codes.InvalidArgument, codes.OutOfRange:
		return classifyIntegrityError(err)
	default:
		if strings.HasPrefix(err.Error(), "scany: expected 1 row, got: ") {
			return database.NewMultipleRowsFoundError(err)
		}
		if strings.HasPrefix(err.Error(), "scany:") || strings.HasPrefix(err.Error(), "scanning:") {
			return database.NewScanError(err)
		}
		return database.NewUnknownError(err)
	}
}

// classifyIntegrityError maps Spanner integrity failures onto the same typed
// errors Postgres returns. Spanner reuses the codes it returns for ordinary
// query failures, so only the message tells them apart. An UnknownError is
// returned by default.
func classifyIntegrityError(err error) error {
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "foreign key"):
		return database.NewForeignKeyError("", "", err)
	case strings.Contains(msg, "unique"):
		return database.NewUniqueError("", "", err)
	case strings.Contains(msg, "not null"), strings.Contains(msg, "null value"):
		return database.NewNotNullError("", "", err)
	// Postgres spells the column width as a CHECK, so report it the same way.
	case strings.Contains(msg, "check constraint"), strings.Contains(msg, "exceeds the maximum size limit"):
		return database.NewCheckError("", "", err)
	default:
		return database.NewUnknownError(err)
	}
}
