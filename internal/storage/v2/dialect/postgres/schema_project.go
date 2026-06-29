package postgres

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

var projectSchema = database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
	domain.ProjectFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.Project) any { return p.ID },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.Project) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ProjectFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(p *domain.Project) any { return p.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ProjectFieldProjectSecret: {
		SQLName:  "project_secret",
		Accessor: func(p *domain.Project) any { return p.ProjectSecret },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldPreviewSecret: {
		SQLName:  "preview_secret",
		Accessor: func(p *domain.Project) any { return p.PreviewSecret },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldPreviewOrigins: {
		SQLName:  "preview_origins",
		Accessor: func(p *domain.Project) any { return p.PreviewOrigins },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
})
