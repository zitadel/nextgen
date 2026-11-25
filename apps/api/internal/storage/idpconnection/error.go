package idpconnection

import (
	"errors"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// ReviseNotFound turns the foreign key violation an unknown parent raises on
// a revision insert into the not-found error the statement contract promises.
// IdP connections and applications both use it.
//
// The revision row's foreign key on (project_id, parent id) is the only thing
// that can report the parent missing, so wrap only the revision insert. All
// three dialects report it as a [database.ForeignKeyError].
func ReviseNotFound(err error) error {
	if fk, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return database.NewNoRowFoundError(fk)
	}
	return err
}
