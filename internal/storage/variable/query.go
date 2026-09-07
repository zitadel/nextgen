package variable

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// VisibleTo restricts the variables table to the rows owner entered, optionally
// narrowed to names. It is [domain.VariableOwner.HasAccessTo] pushed into SQL:
// every owner column has to match exactly.
//
// An earlier revision admitted a row whose column was unset, so a project value
// was readable from every environment. Equality replaced it: an owner is an
// address, not a position in a ladder, and a name at an owner is one row rather
// than a set to rank.
//
// Filtering here rather than after the scan is what keeps another environment's
// variable out of a read. The domain predicate is not applied a second time, so
// unlike the settings ladder this replaced, an unfiltered caller is not safe --
// every read goes through here.
func VisibleTo(owner domain.VariableOwner, names ...string) *database.ListOptions[VariableStorageField] {
	filters := []database.Filter[VariableStorageField]{
		database.Equal(database.Col(VariableStorageFieldProjectID), owner.ProjectID),
		database.Equal(database.Col(VariableStorageFieldEnvironmentName), owner.EnvironmentName),
	}
	if len(names) > 0 {
		filters = append(filters, anyName(names))
	}

	return &database.ListOptions[VariableStorageField]{
		Filter:     database.And(filters...),
		Pagination: database.Page[VariableStorageField]{OrderBy: ByName()},
	}
}

// ByName gives the read a total order that does not depend on physical row
// order, so the same owner reading the same table twice gets the same slice.
// Name alone is enough to be total: the read admits one owner, and the primary
// key makes a name unique within it.
func ByName() database.OrderBy[VariableStorageField] {
	return database.OrderBy[VariableStorageField]{
		Columns: []database.Column[VariableStorageField]{
			database.Col(VariableStorageFieldName),
		},
		Direction: database.OrderAsc,
	}
}

// anyName is an OR over equalities; the database package has no IN filter.
func anyName(names []string) database.Filter[VariableStorageField] {
	terms := make([]database.Filter[VariableStorageField], 0, len(names))
	for _, name := range names {
		terms = append(terms, database.Equal(database.Col(VariableStorageFieldName), name))
	}
	return database.Or(terms...)
}

// ToDomain converts scanned rows, preserving the order they were scanned in.
func ToDomain(rows []*VariableStorage) []*domain.Variable {
	variables := make([]*domain.Variable, 0, len(rows))
	for _, row := range rows {
		variables = append(variables, RowToDomain(row))
	}
	return variables
}

// RowToDomain converts one row into the domain variable.
func RowToDomain(row *VariableStorage) *domain.Variable {
	return &domain.Variable{
		Name: row.Name,
		Owner: domain.VariableOwner{
			ProjectID:       row.ProjectID,
			EnvironmentName: row.EnvironmentName,
		},
		Value:    row.Value,
		IsSecret: row.IsSecret,
	}
}
