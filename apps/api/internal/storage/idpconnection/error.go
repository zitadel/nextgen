package idpconnection

import (
	"errors"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// ReviseNotFound turns the foreign key violation an unknown connection raises
// into the not-found error the statement contract promises.
//
// A revise is a single insert of the revision row, so the foreign key on
// (project_id, connection_id) is the only thing that can report the connection
// missing. All three dialects report it as a [database.ForeignKeyError].
func ReviseNotFound(err error) error {
	if fk, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return database.NewNoRowFoundError(fk)
	}
	return err
}
