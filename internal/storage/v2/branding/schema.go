package branding

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Schema binds branding list/filter/order fields for both dialects.
// Nested content lives in the definition JSON column and is handled by
// Marshal/ToDomain — not as list Schema columns.
var Schema = database.NewSchema(map[domain.BrandingField]database.FieldBinding[domain.Branding]{
	domain.BrandingFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(b *domain.Branding) any { return b.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.BrandingFieldID: {
		SQLName:  "id",
		Accessor: func(b *domain.Branding) any { return b.ID },
		Coerce:   database.CoerceString,
	},
	domain.BrandingFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(b *domain.Branding) any { return b.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
