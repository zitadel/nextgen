// Package policystore holds the read plumbing every dialect shares for
// operation policies joined to their revisions (ADR 066).
package policystore

import (
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds policy filter fields for all dialects. The names are qualified
// because the read joins the policy table `p` to the revision table `r`, and
// project_id, id and created_at exist on both.
var Schema = database.NewSchema(map[domain.PolicyField]database.FieldBinding[domain.Policy]{
	domain.PolicyFieldProjectID: {
		SQLName:  "p.project_id",
		Accessor: func(p *domain.Policy) any { return p.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.PolicyFieldID: {
		SQLName:  "p.id",
		Accessor: func(p *domain.Policy) any { return p.ID },
		Coerce:   database.CoerceString,
	},
	domain.PolicyFieldOperation: {
		SQLName:  "p.operation",
		Accessor: func(p *domain.Policy) any { return p.Operation },
		Coerce:   database.CoerceString,
	},
	domain.PolicyFieldRevisionID: {
		SQLName:  "r.id",
		Accessor: func(p *domain.Policy) any { return p.RevisionID },
		Coerce:   database.CoerceString,
	},
	domain.PolicyFieldCreatedAt: {
		SQLName:  "p.created_at",
		Accessor: func(p *domain.Policy) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.PolicyFieldUpdatedAt: {
		SQLName:  "r.created_at",
		Accessor: func(p *domain.Policy) any { return p.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})

// ByOperation filters the policy of one operation in one project.
func ByOperation(projectID, operation string) database.Filter[domain.PolicyField] {
	return database.And(
		database.Equal(database.Col(domain.PolicyFieldProjectID), projectID),
		database.Equal(database.Col(domain.PolicyFieldOperation), operation),
	)
}

// ByID filters one policy in one project.
func ByID(projectID, id string) database.Filter[domain.PolicyField] {
	return database.And(
		database.Equal(database.Col(domain.PolicyFieldProjectID), projectID),
		database.Equal(database.Col(domain.PolicyFieldID), id),
	)
}

// ByRevision filters one revision in one project.
func ByRevision(projectID, revisionID string) database.Filter[domain.PolicyField] {
	return database.And(
		database.Equal(database.Col(domain.PolicyFieldProjectID), projectID),
		database.Equal(database.Col(domain.PolicyFieldRevisionID), revisionID),
	)
}

// FirstPublishedFirst orders policies by their first publish, oldest first;
// id breaks ties between policies published in the same instant.
func FirstPublishedFirst() database.OrderBy[domain.PolicyField] {
	return database.OrderBy[domain.PolicyField]{
		Columns: []database.Column[domain.PolicyField]{
			database.Col(domain.PolicyFieldCreatedAt),
			database.Col(domain.PolicyFieldID),
		},
		Direction: database.OrderAsc,
	}
}

// NewestRevisionFirst orders the revisions of one policy newest first. The
// unique index on (project_id, policy_id, created_at) already makes the order
// total; the revision id keeps the cursor's keyset unique.
func NewestRevisionFirst() database.OrderBy[domain.PolicyField] {
	return database.OrderBy[domain.PolicyField]{
		Columns: []database.Column[domain.PolicyField]{
			database.Col(domain.PolicyFieldUpdatedAt),
			database.Col(domain.PolicyFieldRevisionID),
		},
		Direction: database.OrderDesc,
	}
}

// ListOptions lists a project's policies, capped at limit, first published
// first. A non-empty operation narrows the list to that operation's policy.
func ListOptions(projectID, operation string, limit uint32) *database.ListOptions[domain.PolicyField] {
	var filter database.Filter[domain.PolicyField] = database.Equal(database.Col(domain.PolicyFieldProjectID), projectID)
	if operation != "" {
		filter = ByOperation(projectID, operation)
	}
	return &database.ListOptions[domain.PolicyField]{
		Filter: filter,
		Pagination: database.Page[domain.PolicyField]{
			Limit:   limit,
			OrderBy: FirstPublishedFirst(),
		},
	}
}

// RevisionListOptions lists the revisions of one policy. A page that names
// no order columns takes NewestRevisionFirst, direction included; a caller
// that flips the direction passes the columns too.
func RevisionListOptions(projectID, policyID string, page database.Page[domain.PolicyField]) *database.ListOptions[domain.PolicyField] {
	if len(page.OrderBy.Columns) == 0 {
		page.OrderBy = NewestRevisionFirst()
	}
	return &database.ListOptions[domain.PolicyField]{
		Filter:     ByID(projectID, policyID),
		Pagination: page,
	}
}

// WithDefaultOrder completes options for ListPolicies: the first-publish
// order when they name none, so a page always has an ORDER BY and a cursor.
// Options are required: a list without them would read every project.
func WithDefaultOrder(opts *database.ListOptions[domain.PolicyField]) (*database.ListOptions[domain.PolicyField], error) {
	if opts == nil {
		return nil, errors.New("policystore: list options are required")
	}
	if len(opts.Pagination.OrderBy.Columns) > 0 {
		return opts, nil
	}
	out := *opts
	out.Pagination.OrderBy = FirstPublishedFirst()
	return &out, nil
}

// ReviseNotFound turns the foreign-key failure of a revise against a policy
// that does not exist into the not-found every other read reports.
func ReviseNotFound(err error) error {
	if fk, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return database.NewNoRowFoundError(fk)
	}
	return err
}
