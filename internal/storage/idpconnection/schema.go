// Package idpconnection holds the read plumbing every dialect shares for
// identity provider connections joined to their revisions.
package idpconnection

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds IdP connection list, filter and order fields for all dialects.
// The names are qualified because the read joins the connection table `c` to
// the revision table `r`, and project_id, id and created_at exist on both.
//
// RevisionID, UpdatedAt and Document bind the revision row: a connection's
// updated_at is the created_at of the revision a read serves.
var Schema = database.NewSchema(map[domain.IDPConnectionField]database.FieldBinding[domain.IDPConnection]{
	domain.IDPConnectionFieldProjectID: {
		SQLName:  "c.project_id",
		Accessor: func(c *domain.IDPConnection) any { return c.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.IDPConnectionFieldID: {
		SQLName:  "c.id",
		Accessor: func(c *domain.IDPConnection) any { return c.ID },
		Coerce:   database.CoerceString,
	},
	domain.IDPConnectionFieldSlug: {
		SQLName:  "c.slug",
		Accessor: func(c *domain.IDPConnection) any { return c.Slug },
		Coerce:   database.CoerceString,
	},
	domain.IDPConnectionFieldRevisionID: {
		SQLName:  "r.id",
		Accessor: func(c *domain.IDPConnection) any { return c.RevisionID },
		Coerce:   database.CoerceString,
	},
	domain.IDPConnectionFieldCreatedAt: {
		SQLName:  "c.created_at",
		Accessor: func(c *domain.IDPConnection) any { return c.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.IDPConnectionFieldUpdatedAt: {
		SQLName:  "r.created_at",
		Accessor: func(c *domain.IDPConnection) any { return c.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.IDPConnectionFieldDocument: {
		SQLName:  "r.document",
		Accessor: func(c *domain.IDPConnection) any { return c.Document },
		Coerce:   database.CoerceBytes,
	},
})
