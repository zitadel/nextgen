package authz

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ManagedGrantListConjunct is ANDed into the managed-grants list SELECT so
// setup (sk_proj) and owning-team (relation=team) rows cannot leak into a
// page. Literals are portable across postgres, sqlite, and spanner.
const ManagedGrantListConjunct = `revoked_at IS NULL AND object_type = 'project' AND principal_type IN ('user', 'team') AND relation IN ('viewer', 'editor', 'admin')`

// ScopeManagedGrantList ANDs project_id into opts so ListManagedGrants cannot
// list across projects even if a caller omits that filter.
func ScopeManagedGrantList(projectID string, opts *database.ListOptions[domain.AuthzAssignmentField]) (*database.ListOptions[domain.AuthzAssignmentField], error) {
	if projectID == "" {
		return nil, fmt.Errorf("project id is required")
	}
	if opts == nil {
		opts = &database.ListOptions[domain.AuthzAssignmentField]{}
	}
	scoped := *opts
	scoped.Filter = database.And(
		database.Equal(database.Col(domain.AuthzAssignmentFieldProjectID), projectID),
		opts.Filter,
	)
	return &scoped, nil
}
