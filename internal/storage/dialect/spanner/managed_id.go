package spanner

import (
	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/storage/dialect/idgen"
)

var managedIDs idgen.Generator = idgen.NewUUID()

func ensureManagedID(id *string, prefix domain.ResourcePrefix) error {
	return idgen.Ensure(id, string(prefix), managedIDs)
}

func (s statements) NewManagedID(prefix string) (string, error) {
	return managedIDs.New(prefix)
}
