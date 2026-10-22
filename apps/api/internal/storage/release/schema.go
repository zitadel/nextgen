package release

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Schema binds release list/filter/order fields for all dialects.
//
// The pinned set and the metadata live in columns nothing filters or orders
// on — pointers in a JSON document, the rest read straight off the row — and
// are handled by Marshal/ToDomain rather than as list Schema columns.
var Schema = database.NewSchema(map[domain.ReleaseField]database.FieldBinding[domain.Release]{
	domain.ReleaseFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(r *domain.Release) any { return r.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.ReleaseFieldID: {
		SQLName:  "id",
		Accessor: func(r *domain.Release) any { return r.ID },
		Coerce:   database.CoerceString,
	},
	domain.ReleaseFieldContentHash: {
		SQLName:  "content_hash",
		Accessor: func(r *domain.Release) any { return r.ContentHash },
		Coerce:   database.CoerceString,
	},
	domain.ReleaseFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(r *domain.Release) any { return r.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
