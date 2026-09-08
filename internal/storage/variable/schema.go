// Package variable holds the dialect-independent row shape, query options and
// domain mapping for the variables table.
//
// A variable row is one [domain.Variable]: a value entered by one owner under
// one name. The owner is the project and, optionally, one of its environments.
// An environment that is not named is stored as the empty string rather than
// NULL, which keeps the natural key usable as a primary key; only the project
// is required, and see the postgres migration for why.
//
// Unlike the settings table this replaces, there is no ladder and no final
// flag, so storage never collapses rows -- and never has to. A read admits one
// owner exactly ([VisibleTo], which is [domain.VariableOwner.HasAccessTo]
// pushed into SQL), and the primary key makes a name unique within it, so a
// name yields at most one row.
package variable

import (
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// VariableStorage is the row shape. It mirrors [domain.Variable] with the
// owner tuple flattened onto the row and the two row timestamps added, neither
// of which the domain type carries.
type VariableStorage struct {
	Name            string
	ProjectID       string
	EnvironmentName string
	Value           any
	IsSecret        bool
	CreatedAt       time.Time
	ModifiedAt      time.Time
}

// Schema binds variable filter/order fields. Both owner columns are NOT NULL
// (environment_name with an empty-string default), so none of the keyset null
// handling applies.
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
	VariableStorageFieldEnvironmentName: {
		SQLName:  "environment_name",
		Accessor: func(v *VariableStorage) any { return v.EnvironmentName },
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
	VariableStorageFieldEnvironmentName
	VariableStorageFieldValue
	VariableStorageFieldIsSecret
	VariableStorageFieldCreatedAt
	VariableStorageFieldModifiedAt
)
