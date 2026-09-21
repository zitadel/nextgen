package idpconnection

import (
	"errors"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// ReviseNotFound turns the composite foreign key violation an unknown
// connection raises into the clean not-found the statement contract promises.
//
// Nothing records the head (ADR 063 §7), so a revise is the single insert of
// the revision row and the foreign key on (project_id, connection_id) is the
// only thing left that can report the connection missing. All three dialects
// classify that violation as a [database.ForeignKeyError], so one mapping
// serves them all.
func ReviseNotFound(err error) error {
	if fk, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return database.NewNoRowFoundError(fk)
	}
	return err
}
