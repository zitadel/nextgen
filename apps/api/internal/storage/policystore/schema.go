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

// ByRevision filters one revision in one project.
func ByRevision(projectID, revisionID string) database.Filter[domain.PolicyField] {
	return database.And(
		database.Equal(database.Col(domain.PolicyFieldProjectID), projectID),
		database.Equal(database.Col(domain.PolicyFieldRevisionID), revisionID),
	)
}

// ReviseNotFound turns the foreign-key failure of a revise against a policy
// that does not exist into the not-found every other read reports.
func ReviseNotFound(err error) error {
	if fk, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return database.NewNoRowFoundError(fk)
	}
	return err
}
