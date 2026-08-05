package sqlite

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/idgen"
)

var managedIDs idgen.Generator = idgen.NewULID()

func ensureManagedID(id *string, prefix domain.ResourcePrefix) error {
	return idgen.Ensure(id, string(prefix), managedIDs)
}

func (s statements) NewManagedID(prefix string) (string, error) {
	return managedIDs.New(prefix)
}
