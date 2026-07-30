package spanner

import (
	"errors"
	"strings"

	"cloud.google.com/go/spanner"
	"google.golang.org/grpc/codes"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

var errTooManyRows = errors.New("spanner: multiple rows in result set")

func wrapError(err error) error {
	if err == nil {
		return nil
	}
	var de domain.Error
	if errors.As(err, &de) {
		return de
	}
	var unimplemented *database.UnimplementedError
	if errors.As(err, &unimplemented) {
		return unimplemented
	}
	if errors.Is(err, spanner.ErrRowNotFound) {
		return database.NewNoRowFoundError(err)
	}
	if errors.Is(err, errTooManyRows) {
		return database.NewMultipleRowsFoundError(err)
	}

	switch spanner.ErrCode(err) {
	case codes.NotFound:
		return database.NewNoRowFoundError(err)
	case codes.AlreadyExists:
		return database.NewUniqueError("", "", err)
	case codes.FailedPrecondition, codes.InvalidArgument:
		// Spanner surfaces several integrity failures as FailedPrecondition /
		// InvalidArgument; classify from the message when possible so callers
		// see the same typed errors as Postgres.
		msg := err.Error()
		lower := strings.ToLower(msg)
		switch {
		case strings.Contains(msg, "Foreign key"):
			return database.NewForeignKeyError("", "", err)
		case strings.Contains(lower, "unique"):
			return database.NewUniqueError("", "", err)
		case strings.Contains(lower, "not null"):
			return database.NewNotNullError("", "", err)
		default:
			return database.NewCheckError("", "", err)
		}
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
