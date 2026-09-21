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
// RevisionID and UpdatedAt bind the revision row rather than the connection:
// every read serves the joined revision, so a connection's updated_at is the
// instant the revision it hands back was created. On the head join that is the
// revision the pointer names; on the revision list it is the row being paged,
// which is why both columns can also carry the keyset.
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
