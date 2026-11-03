// Package variable holds the dialect-independent row shape, query options and
// domain mapping for the variables table.
//
// A variable row is one [domain.Variable]: a value entered by one project
// under one name, for one kind of target. Unlike the settings table this
// replaces, there is no ladder and no final flag, so storage never collapses
// rows -- and never has to. A read admits one owner and one kind exactly
// ([VisibleTo], which is [domain.VariableOwner.HasAccessTo] pushed into SQL
// and narrowed to the kind), and the primary key makes a name unique within
// them, so a name yields at most one row.
package variable

import (
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// VariableStorage is the row shape. It mirrors [domain.Variable] with the
// owner tuple flattened onto the row and the two row timestamps added, neither
// of which the domain type carries.
type VariableStorage struct {
	Name      string
	ProjectID string
	// Kind is parsed from the TEXT column by the dialect scan, so an unknown
	// kind fails the read instead of decoding to primary.
	Kind       domain.DeploymentOriginKind
	Value      any
	IsSecret   bool
	CreatedAt  time.Time
	ModifiedAt time.Time
}

// Schema binds variable filter/order fields. The owner column is NOT NULL, so
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
	// Bound as its string, never as the enum: the Spanner client cannot
	// encode the enum, and the column holds the name so a reordering of the
	// Go constants cannot reinterpret rows already written.
	VariableStorageFieldKind: {
		SQLName:  "kind",
		Accessor: func(v *VariableStorage) any { return v.Kind.String() },
		Coerce:   database.CoerceString,
	},
})

type VariableStorageField uint8

const (
	VariableStorageFieldName VariableStorageField = iota
	VariableStorageFieldProjectID
	VariableStorageFieldValue
	VariableStorageFieldIsSecret
	VariableStorageFieldCreatedAt
	VariableStorageFieldModifiedAt
	VariableStorageFieldKind
)
