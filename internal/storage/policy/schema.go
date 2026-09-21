// Package policy holds the shared column bindings and encoding helpers for
// the policies table used by the dialect statements.
package policy

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds policy list/filter/order fields for every dialect. The
// instance body lives in the definition JSON column and is handled by
// Marshal/ToDomain, not as list columns.
var Schema = database.NewSchema(map[domain.PolicyField]database.FieldBinding[domain.Policy]{
	domain.PolicyFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(p *domain.Policy) any { return p.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.PolicyFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.Policy) any { return p.ID },
		Coerce:   database.CoerceString,
	},
	domain.PolicyFieldOperation: {
		SQLName:  "operation",
		Accessor: func(p *domain.Policy) any { return p.Operation },
		Coerce:   database.CoerceString,
	},
	domain.PolicyFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.Policy) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
