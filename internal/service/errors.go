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
