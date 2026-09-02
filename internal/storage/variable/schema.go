// Package variable holds the dialect-independent row shape, query options and
// domain mapping for the variables table.
//
// A variable row is one [domain.Variable]: a value entered by one owner under
// one name. The owner hierarchy is encoded positionally, not as a level column
// -- an owner id that is unset is stored as the empty string, so a
// project-level variable carries project_id and leaves team_id, user_schema_id
// and user_id empty.
//
// Unlike the settings table this replaces, variables do not override one
// another: there is no ladder and no final flag, so storage never collapses
// rows. It only narrows the set a requester is allowed to see ([VisibleTo]),
// which is [domain.VariableOwner.HasAccessTo] pushed into SQL.
package variable

import (
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// VariableStorage is the row shape. It mirrors [domain.Variable] with the
// owner tuple flattened onto the row and the two row timestamps added, neither
// of which the domain type carries.
type VariableStorage struct {
	Name         string
	ProjectID    string
	TeamID       string
	UserSchemaID string
	UserID       string
	Value        any
	IsSecret     bool
	CreatedAt    time.Time
	ModifiedAt   time.Time
}

// Schema binds variable filter/order fields. Every owner column is NOT NULL
// with an empty-string default, so none of the keyset null handling applies.
var Schema = database.NewSchema(map[VariableStorageField]database.FieldBinding[VariableStorage]{
	VariableStorageFieldName: {
		SQLName:  "name",
		Accessor: func(v *VariableStorage) any { return v.Name },
		Coerce:   database.CoerceString,
	},
	VariableStorageFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(v *VariableStorage) any { return v.ProjectID },
		Coerce:   database.CoerceString,
	},
	VariableStorageFieldTeamID: {
		SQLName:  "team_id",
		Accessor: func(v *VariableStorage) any { return v.TeamID },
		Coerce:   database.CoerceString,
	},
	VariableStorageFieldUserSchemaID: {
		SQLName:  "user_schema_id",
		Accessor: func(v *VariableStorage) any { return v.UserSchemaID },
		Coerce:   database.CoerceString,
	},
	VariableStorageFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(v *VariableStorage) any { return v.UserID },
		Coerce:   database.CoerceString,
	},
	VariableStorageFieldValue: {
		SQLName:  "value",
		Accessor: func(v *VariableStorage) any { return v.Value },
		Coerce:   database.CoerceJSON[any],
	},
	VariableStorageFieldIsSecret: {
		SQLName:  "is_secret",
		Accessor: func(v *VariableStorage) any { return v.IsSecret },
		Coerce:   database.CoerceBool,
	},
	VariableStorageFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(v *VariableStorage) any { return v.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	VariableStorageFieldModifiedAt: {
		SQLName:  "modified_at",
		Accessor: func(v *VariableStorage) any { return v.ModifiedAt },
		Coerce:   database.CoerceTime,
	},
})

type VariableStorageField uint8

const (
	VariableStorageFieldName VariableStorageField = iota
	VariableStorageFieldProjectID
	VariableStorageFieldTeamID
	VariableStorageFieldUserSchemaID
	VariableStorageFieldUserID
	VariableStorageFieldValue
	VariableStorageFieldIsSecret
	VariableStorageFieldCreatedAt
	VariableStorageFieldModifiedAt
)
