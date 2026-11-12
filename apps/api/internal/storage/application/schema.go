// Package application holds what every dialect shares for applications: the
// read plumbing for applications joined to their revisions, and the client_id
// fill of the stored document.
package application

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds application filter fields for all dialects. The names are
// qualified because the read joins the application table `a` to the revision
// table `r`, and project_id, id and created_at exist on both.
//
// RevisionID, UpdatedAt and Document bind the revision row: an application's
// updated_at is the created_at of the revision a read serves.
var Schema = database.NewSchema(map[domain.ApplicationField]database.FieldBinding[domain.Application]{
	domain.ApplicationFieldProjectID: {
		SQLName:  "a.project_id",
		Accessor: func(application *domain.Application) any { return application.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.ApplicationFieldID: {
		SQLName:  "a.id",
		Accessor: func(application *domain.Application) any { return application.ID },
		Coerce:   database.CoerceString,
	},
	domain.ApplicationFieldSlug: {
		SQLName:  "a.slug",
		Accessor: func(application *domain.Application) any { return application.Slug },
		Coerce:   database.CoerceString,
	},
	domain.ApplicationFieldRevisionID: {
		SQLName:  "r.id",
		Accessor: func(application *domain.Application) any { return application.RevisionID },
		Coerce:   database.CoerceString,
	},
	domain.ApplicationFieldCreatedAt: {
		SQLName:  "a.created_at",
		Accessor: func(application *domain.Application) any { return application.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ApplicationFieldUpdatedAt: {
		SQLName:  "r.created_at",
		Accessor: func(application *domain.Application) any { return application.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ApplicationFieldDocument: {
		SQLName:  "r.document",
		Accessor: func(application *domain.Application) any { return application.Document },
		Coerce:   database.CoerceBytes,
	},
})
