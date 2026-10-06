// Package variable holds the dialect-independent row shape, query options and
// domain mapping for the variables table.
//
// A variable row is one [domain.Variable]: a value entered under one name for
// one applies_to. The project is the owner; applies_to says whether the
// value is for every deploy or the override a preview deploy prefers.
//
// Storage never collapses rows. A read admits one project ([VisibleTo], which
// is [domain.VariableOwner.HasAccessTo] pushed into SQL) and optionally one
// applies_to, and the primary key makes (name, applies_to) unique within a
// project.
package variable

import (
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// VariableStorage is the row shape. It mirrors [domain.Variable] with the two
// row timestamps added, neither of which the domain type carries.
type VariableStorage struct {
	Name       string
	ProjectID  string
	AppliesTo  string
	Value      any
	IsSecret   bool
	CreatedAt  time.Time
	ModifiedAt time.Time
}

// Schema binds variable filter/order fields. Every column is NOT NULL, so
// none of the keyset null handling applies.
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
	VariableStorageFieldAppliesTo: {
		SQLName:  "applies_to",
		Accessor: func(v *VariableStorage) any { return v.AppliesTo },
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
	VariableStorageFieldAppliesTo
	VariableStorageFieldValue
	VariableStorageFieldIsSecret
	VariableStorageFieldCreatedAt
	VariableStorageFieldModifiedAt
)
