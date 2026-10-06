package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewestFirst is deployed_at DESC, id DESC. id breaks deployed_at ties
// deterministically when two deployments share a timestamp. Filtered to one
// origin, the first row under this order is what that target serves.
func NewestFirst() database.OrderBy[domain.DeploymentField] {
	return database.OrderBy[domain.DeploymentField]{
		Columns: []database.Column[domain.DeploymentField]{
			database.Col(domain.DeploymentFieldDeployedAt),
			database.Col(domain.DeploymentFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ByIDs matches the named deployments of one project. An OR of equals rather
// than an IN clause, because IN is not in the shared filter vocabulary and
// the id sets here are small.
func ByIDs(projectID string, ids []string) database.Filter[domain.DeploymentField] {
	matches := make([]database.Filter[domain.DeploymentField], len(ids))
	for i, id := range ids {
		matches[i] = database.Equal(database.Col(domain.DeploymentFieldID), id)
	}
	return database.And(
		database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
		database.Or(matches...),
	)
}

// ListOptions returns options for listing a project's deployments, newest
// first, capped at limit. A non-nil origin narrows the list to that target's
// history (the empty string being the project default); a non-nil deployID
// to the rows one deploy wrote.
func ListOptions(projectID string, origin, deployID *string, limit uint32) *database.ListOptions[domain.DeploymentField] {
	filters := []database.Filter[domain.DeploymentField]{
		database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
	}
	if origin != nil {
		filters = append(filters, database.Equal(database.Col(domain.DeploymentFieldOrigin), *origin))
	}
	if deployID != nil {
		filters = append(filters, database.Equal(database.Col(domain.DeploymentFieldDeployID), *deployID))
	}
	return &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.DeploymentField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}

// NewestOf returns options reading the newest row of one target, optionally
// narrowed to one release.
func NewestOf(projectID, origin string, releaseID *string) *database.ListOptions[domain.DeploymentField] {
	filters := []database.Filter[domain.DeploymentField]{
		database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
		database.Equal(database.Col(domain.DeploymentFieldOrigin), origin),
	}
	if releaseID != nil {
		filters = append(filters, database.Equal(database.Col(domain.DeploymentFieldReleaseID), *releaseID))
	}
	return &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.DeploymentField]{
			Limit:   1,
			OrderBy: NewestFirst(),
		},
	}
}
