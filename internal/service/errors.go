package service

import (
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// mapStorageError translates storage-layer errors into domain errors where needed.
func mapStorageError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*database.UnimplementedError](err); ok {
		return domain.ErrNotImplemented().WithParent(err)
	}
	// Without this the callers' "failed to commit transaction" catch-all turns a
	// spent retry budget into an unexplained 500.
	if _, ok := errors.AsType[*database.UnavailableError](err); ok {
		return domain.ErrUnavailable().WithParent(err)
	}
	if dbErr, ok := errors.AsType[database.Error](err); ok {
		return domain.Error{
			Code:    dbErr.Code,
			Message: dbErr.Message,
			Details: dbErr.Details,
			Parent:  dbErr.Parent,
			Origin:  dbErr.Origin,
		}
	}
	return err
}
