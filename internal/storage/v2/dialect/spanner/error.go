package spanner

import (
	"errors"
	"strings"

	"cloud.google.com/go/spanner"
	"google.golang.org/grpc/codes"

	"github.com/zitadel/nextgen/internal/storage/database"
)

var errTooManyRows = errors.New("spanner: multiple rows in result set")

func wrapError(err error) error {
	if err == nil {
		return nil
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
		return database.NewCheckError("", "", err)
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
