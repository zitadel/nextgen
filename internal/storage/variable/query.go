package variable

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// VisibleTo restricts the variables table to the rows requester may read,
// optionally narrowed to names. It is [domain.VariableOwner.HasAccessTo] pushed
// into SQL: for each owner column a row qualifies when the column is unset (the
// variable is owned further up the hierarchy) or matches the requester exactly
// (the variable is on the requester's own branch).
//
// Filtering here rather than after the scan is what keeps a sibling team's
// variable out of a read. The domain predicate is not applied a second time, so
// unlike the settings ladder this replaced, an unfiltered caller is not safe --
// every read goes through here.
func VisibleTo(requester domain.VariableOwner, names ...string) *database.ListOptions[VariableStorageField] {
	filters := []database.Filter[VariableStorageField]{
		ownerScope(VariableStorageFieldProjectID, requester.ProjectID),
		ownerScope(VariableStorageFieldEnvironmentName, requester.EnvironmentName),
		ownerScope(VariableStorageFieldTeamID, requester.TeamID),
		ownerScope(VariableStorageFieldUserSchemaID, requester.UserSchemaID),
		ownerScope(VariableStorageFieldUserID, requester.UserID),
	}
	if len(names) > 0 {
		filters = append(filters, anyName(names))
	}

	return &database.ListOptions[VariableStorageField]{
		Filter:     database.And(filters...),
		Pagination: database.Page[VariableStorageField]{OrderBy: NameThenOwner()},
	}
}

// NameThenOwner gives the read a total order that does not depend on physical
// row order, so the same requester reading the same table twice gets the same
// slice. Name leads so rows sharing a name are contiguous; the owner columns
// then run broadest to narrowest, since the unset owner id is the empty string
// and sorts before any minted id.
func NameThenOwner() database.OrderBy[VariableStorageField] {
	return database.OrderBy[VariableStorageField]{
		Columns: []database.Column[VariableStorageField]{
			database.Col(VariableStorageFieldName),
			database.Col(VariableStorageFieldProjectID),
			database.Col(VariableStorageFieldEnvironmentName),
			database.Col(VariableStorageFieldTeamID),
			database.Col(VariableStorageFieldUserSchemaID),
			database.Col(VariableStorageFieldUserID),
		},
		Direction: database.OrderAsc,
	}
}

// ownerScope matches variables owned at or above requesterID for one column.
// A requester that is itself unset at this level can only see variables that
// are also unset there, so the disjunction collapses to a single equality.
func ownerScope(field VariableStorageField, requesterID string) database.Filter[VariableStorageField] {
	if requesterID == "" {
		return database.Equal(database.Col(field), "")
	}
	return database.Or(
		database.Equal(database.Col(field), ""),
		database.Equal(database.Col(field), requesterID),
	)
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
			TeamID:          row.TeamID,
			UserSchemaID:    row.UserSchemaID,
			UserID:          row.UserID,
		},
		Value:    row.Value,
		IsSecret: row.IsSecret,
	}
}
