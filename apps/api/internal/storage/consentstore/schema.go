// Package consentstore holds the read plumbing every dialect shares for
// users' consents to OAuth clients (ADR 082 §8).
package consentstore

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds consent filter and order fields for all dialects.
var Schema = database.NewSchema(map[domain.ConsentField]database.FieldBinding[domain.Consent]{
	domain.ConsentFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(c *domain.Consent) any { return c.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.ConsentFieldID: {
		SQLName:  "id",
		Accessor: func(c *domain.Consent) any { return c.ID },
		Coerce:   database.CoerceString,
	},
	domain.ConsentFieldUserID: {
		SQLName:  "user_id",
		Accessor: func(c *domain.Consent) any { return c.UserID },
		Coerce:   database.CoerceString,
	},
	domain.ConsentFieldClientID: {
		SQLName:  "client_id",
		Accessor: func(c *domain.Consent) any { return c.ClientID },
		Coerce:   database.CoerceString,
	},
	domain.ConsentFieldResource: {
		SQLName:  "resource",
		Accessor: func(c *domain.Consent) any { return c.Resource },
		Coerce:   database.CoerceString,
	},
	domain.ConsentFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(c *domain.Consent) any { return c.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ConsentFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(c *domain.Consent) any { return c.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ConsentFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(c *domain.Consent) any { return c.ExpiresAt },
		Coerce:   database.CoerceTime,
	},
})
