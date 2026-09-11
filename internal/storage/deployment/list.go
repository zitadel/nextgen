package deployment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewestFirst is deployed_at DESC, id DESC. id breaks deployed_at ties
// deterministically when two deployments share a timestamp. Filtered to one
// environment, the first row under this order is its current deployment.
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
// the id sets here are small — the current-deployment pointers of one page of
// environments.
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
// first, capped at limit. A non-nil environmentID narrows the list to that
// environment's history.
func ListOptions(projectID string, environmentID *string, limit uint32) *database.ListOptions[domain.DeploymentField] {
	filter := database.Filter[domain.DeploymentField](
		database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID))
	if environmentID != nil {
		filter = database.And(
			filter,
			database.Equal(database.Col(domain.DeploymentFieldEnvironmentID), *environmentID),
		)
	}
	return &database.ListOptions[domain.DeploymentField]{
		Filter: filter,
		Pagination: database.Page[domain.DeploymentField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}

// CheckExpectedCurrent enforces the optimistic-concurrency guard on create.
// current is the environment's current deployment, nil when nothing runs; on
// a mismatch the conflict error carries what actually runs, read by the
// dialect because only its transaction sees the locked state.
func CheckExpectedCurrent(current *domain.Deployment, expected *string) error {
	if expected == nil || (current != nil && current.ID == *expected) {
		return nil
	}
	details := domain.DeploymentConflictDetails{}
	if current != nil {
		details.CurrentDeploymentID = current.ID
		details.CurrentReleaseID = current.ReleaseID
	}
	return domain.ErrDeploymentConflict(details)
}
