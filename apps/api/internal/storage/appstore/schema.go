// Package appstore holds the read plumbing every dialect shares for apps
// joined to their revisions.
package appstore

import (
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds app list, filter and order fields for all dialects. The names
// are qualified because the read joins the app table `a` to the revision
// table `r`, and project_id, id and created_at exist on both.
//
// RevisionID, UpdatedAt and Document bind the revision row: an app's
// updated_at is the created_at of the revision a read serves.
var Schema = database.NewSchema(map[domain.AppField]database.FieldBinding[domain.App]{
	domain.AppFieldProjectID: {
		SQLName:  "a.project_id",
		Accessor: func(a *domain.App) any { return a.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.AppFieldID: {
		SQLName:  "a.id",
		Accessor: func(a *domain.App) any { return a.ID },
		Coerce:   database.CoerceString,
	},
	domain.AppFieldSlug: {
		SQLName:  "a.slug",
		Accessor: func(a *domain.App) any { return a.Slug },
		Coerce:   database.CoerceString,
	},
	domain.AppFieldSource: {
		SQLName:  "a.source",
		Accessor: func(a *domain.App) any { return string(a.Source) },
		Coerce:   database.CoerceString,
	},
	domain.AppFieldRevisionID: {
		SQLName:  "r.id",
		Accessor: func(a *domain.App) any { return a.RevisionID },
		Coerce:   database.CoerceString,
	},
	domain.AppFieldCreatedAt: {
		SQLName:  "a.created_at",
		Accessor: func(a *domain.App) any { return a.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.AppFieldUpdatedAt: {
		SQLName:  "r.created_at",
		Accessor: func(a *domain.App) any { return a.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.AppFieldDocument: {
		SQLName:  "r.document",
		Accessor: func(a *domain.App) any { return a.Document },
		Coerce:   database.CoerceBytes,
	},
})

// EnsureListOptions returns opts with the default created_at + id ascending
// order when OrderBy is unset. A nil opts becomes an empty ListOptions.
func EnsureListOptions(opts *database.ListOptions[domain.AppField]) *database.ListOptions[domain.AppField] {
	if opts == nil {
		opts = &database.ListOptions[domain.AppField]{}
	}
	out := *opts
	if len(out.Pagination.OrderBy.Columns) == 0 {
		out.Pagination.OrderBy = database.OrderBy[domain.AppField]{
			Columns: []database.Column[domain.AppField]{
				database.Col(domain.AppFieldCreatedAt),
				database.Col(domain.AppFieldID),
			},
			Direction: database.OrderAsc,
		}
	}
	return &out
}

// RevisionsNewestFirst orders by the revision's created_at DESC, then its id
// DESC. Both columns sit on the revision row, and the id keeps the keyset
// cursor unique.
func RevisionsNewestFirst() database.OrderBy[domain.AppField] {
	return database.OrderBy[domain.AppField]{
		Columns: []database.Column[domain.AppField]{
			database.Col(domain.AppFieldUpdatedAt),
			database.Col(domain.AppFieldRevisionID),
		},
		Direction: database.OrderDesc,
	}
}

// RevisionsListOptions scopes a list to one app's revisions, newest first.
func RevisionsListOptions(projectID, appID string, page database.Page[domain.AppField]) *database.ListOptions[domain.AppField] {
	if len(page.OrderBy.Columns) == 0 {
		page.OrderBy = RevisionsNewestFirst()
	}
	return &database.ListOptions[domain.AppField]{
		Filter: database.And(
			database.Equal(database.Col(domain.AppFieldProjectID), projectID),
			database.Equal(database.Col(domain.AppFieldID), appID),
		),
		Pagination: page,
	}
}

// ReviseNotFound turns the foreign key violation an unknown app raises into
// the not-found error the statement contract promises: a revise is a single
// insert of the revision row, so the foreign key is the only thing that can
// report the app missing.
func ReviseNotFound(err error) error {
	if fk, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return database.NewNoRowFoundError(fk)
	}
	return err
}
