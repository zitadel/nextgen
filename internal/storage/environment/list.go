package environment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// CreationOrder is created_at ASC, name ASC.
//
// name is the tiebreak rather than id, because id cannot order these rows
// portably: a project's environments are seeded inside the project-creation
// transaction, where postgres `now()` is the transaction timestamp and spanner
// evaluates one `CURRENT_TIMESTAMP()`, so every seeded row shares a created_at
// and the tiebreak decides the whole result. id is a monotonic ULID under
// postgres and sqlite but a random UUID under spanner (ADR 047), so ordering
// by it returns a different order per dialect.
//
// name is NOT NULL and unique per project, so with project_id fixed by the
// filter this is a total order on every dialect — which keyset pagination
// needs, or a page boundary could skip or repeat a row.
//
// It is not a promotion order: seeded environments come back alphabetically,
// not dev → staging → prod. Ordering environments by their role in a pipeline
// needs a position the rows do not carry, and defining one belongs to the
// environment lifecycle (#528) rather than here.
func CreationOrder() database.OrderBy[domain.EnvironmentField] {
	return database.OrderBy[domain.EnvironmentField]{
		Columns: []database.Column[domain.EnvironmentField]{
			database.Col(domain.EnvironmentFieldCreatedAt),
			database.Col(domain.EnvironmentFieldName),
		},
		Direction: database.OrderAsc,
	}
}

// ListOptions returns options for listing a project's environments in
// creation order, capped at limit and resumed from cursor.
func ListOptions(projectID string, limit uint32, cursor []byte) *database.ListOptions[domain.EnvironmentField] {
	return &database.ListOptions[domain.EnvironmentField]{
		Filter: database.Equal(database.Col(domain.EnvironmentFieldProjectID), projectID),
		Pagination: database.Page[domain.EnvironmentField]{
			Limit:   limit,
			Cursor:  cursor,
			OrderBy: CreationOrder(),
		},
	}
}
