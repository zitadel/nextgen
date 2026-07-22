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
	var unimplemented *database.UnimplementedError
	if errors.As(err, &unimplemented) {
		return domain.ErrNotImplemented().WithParent(err)
	}
	return err
}
