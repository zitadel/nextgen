package deployment

import (
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewestFirst is deployed_at DESC, id DESC.
func NewestFirst() database.OrderBy[domain.DeploymentField] {
	return database.OrderBy[domain.DeploymentField]{
		Columns: []database.Column[domain.DeploymentField]{
			database.Col(domain.DeploymentFieldDeployedAt),
			database.Col(domain.DeploymentFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ByIDs matches the named deployments of one project.
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

// ListOptions lists a project's deployments newest first; a non-nil origin
// narrows it to that origin's history.
func ListOptions(projectID string, origin *string, limit uint32) *database.ListOptions[domain.DeploymentField] {
	filters := []database.Filter[domain.DeploymentField]{
		database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
	}
	if origin != nil {
		filters = append(filters, database.CorrelatedEqual(database.Col(domain.DeploymentFieldOrigin), *origin))
	}
	return &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.DeploymentField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}

// LiveListOptions lists the deployments some origin still serves, newest
// first; a non-nil releaseID narrows it to that release. ListLiveDeployments
// applies the time with LiveAt.
func LiveListOptions(projectID string, releaseID *string, limit uint32) *database.ListOptions[domain.DeploymentField] {
	opts := ListOptions(projectID, nil, limit)
	if releaseID != nil {
		opts.Filter = database.And(opts.Filter, database.Equal(database.Col(domain.DeploymentFieldReleaseID), *releaseID))
	}
	return opts
}

// LiveAt returns opts narrowed to the deployments some origin serves at now.
func LiveAt(opts *database.ListOptions[domain.DeploymentField], now time.Time) *database.ListOptions[domain.DeploymentField] {
	live := *opts
	live.Filter = database.And(opts.Filter, database.CorrelatedEqual(database.Col(domain.DeploymentFieldLive), now))
	return &live
}
