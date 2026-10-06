package variable

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// VisibleTo restricts the variables table to one project's rows, optionally
// narrowed to one applies_to and to names. It is
// [domain.VariableOwner.HasAccessTo] pushed into SQL.
//
// Filtering here rather than after the scan is what keeps another project's
// variable out of a read. The domain predicate is not applied a second time,
// so an unfiltered caller is not safe -- every read goes through here.
func VisibleTo(projectID string, appliesTo *domain.VariableAppliesTo, names ...string) *database.ListOptions[VariableStorageField] {
	filters := []database.Filter[VariableStorageField]{
		database.Equal(database.Col(VariableStorageFieldProjectID), projectID),
	}
	if appliesTo != nil {
		filters = append(filters, database.Equal(database.Col(VariableStorageFieldAppliesTo), appliesTo.String()))
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
// order: name, then applies_to, which together with the project is the
// primary key.
func ByName() database.OrderBy[VariableStorageField] {
	return database.OrderBy[VariableStorageField]{
		Columns: []database.Column[VariableStorageField]{
			database.Col(VariableStorageFieldName),
			database.Col(VariableStorageFieldAppliesTo),
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
func ToDomain(rows []*VariableStorage) ([]*domain.Variable, error) {
	variables := make([]*domain.Variable, 0, len(rows))
	for _, row := range rows {
		v, err := RowToDomain(row)
		if err != nil {
			return nil, err
		}
		variables = append(variables, v)
	}
	return variables, nil
}

// RowToDomain converts one row into the domain variable.
func RowToDomain(row *VariableStorage) (*domain.Variable, error) {
	appliesTo, err := domain.VariableAppliesToString(row.AppliesTo)
	if err != nil {
		return nil, err
	}
	return &domain.Variable{
		Name:      row.Name,
		Owner:     domain.VariableOwner{ProjectID: row.ProjectID},
		AppliesTo: appliesTo,
		Value:     row.Value,
		IsSecret:  row.IsSecret,
	}, nil
}
