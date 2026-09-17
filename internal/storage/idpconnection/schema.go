// Package idpconnection binds the identity provider connection read:
// connections joined to the revision their head pointer names.
package idpconnection

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds IdP connection list/filter/order fields for all dialects.
//
// The SQL names are table-qualified because the read is a join and every
// dialect aliases the connection table `c` and the revision table `r`:
// `project_id`, `id` and `created_at` exist on both sides, so an unqualified
// name would be ambiguous.
//
// RevisionID binds the head pointer on the connection rather than the revision
// row's own id, so filtering and ordering stay on the outer table the keyset
// pages over. The pinned read serves a revision id the head does not name, and
// goes through a static statement rather than this schema.
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
		SQLName:  "c.latest_revision_id",
		Accessor: func(c *domain.IDPConnection) any { return c.RevisionID },
		Coerce:   database.CoerceString,
	},
	domain.IDPConnectionFieldCreatedAt: {
		SQLName:  "c.created_at",
		Accessor: func(c *domain.IDPConnection) any { return c.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.IDPConnectionFieldUpdatedAt: {
		SQLName:  "c.updated_at",
		Accessor: func(c *domain.IDPConnection) any { return c.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.IDPConnectionFieldDocument: {
		SQLName:  "r.document",
		Accessor: func(c *domain.IDPConnection) any { return c.Document },
		Coerce:   database.CoerceBytes,
	},
})
