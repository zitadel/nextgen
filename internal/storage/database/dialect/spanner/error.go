package spanner

import (
	"database/sql"
	"errors"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/zitadel/nextgen/internal/storage/database"
)

func wrapError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return database.NewNoRowFoundError(err)
	}

	if s, ok := status.FromError(err); ok && s.Code() != codes.OK {
		switch s.Code() {
		case codes.NotFound:
			return database.NewNoRowFoundError(err)
		case codes.AlreadyExists:
			return database.NewUniqueError("", "", err)
		case codes.FailedPrecondition, codes.InvalidArgument:
			return database.NewCheckError("", "", err)
		case codes.Aborted:
			if s.Message() == "Transaction was aborted due to a concurrent modification" {
				return database.NewConcurrentModificationError(err)
			}
			fallthrough
		default:
			return database.NewUnknownError(err)
		}
	}

	if strings.HasPrefix(err.Error(), "scany: expected 1 row, got: ") {
		return database.NewMultipleRowsFoundError(err)
	}
	if strings.HasPrefix(err.Error(), "scany:") || strings.HasPrefix(err.Error(), "scanning:") {
		return database.NewScanError(err)
	}

	return database.NewUnknownError(err)
}
