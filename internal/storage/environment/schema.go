package environment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var Schema = database.NewSchema(map[domain.EnvironmentField]database.FieldBinding[domain.Environment]{
	domain.EnvironmentFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(e *domain.Environment) any { return e.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.EnvironmentFieldID: {
		SQLName:  "id",
		Accessor: func(e *domain.Environment) any { return e.ID },
		Coerce:   database.CoerceString,
	},
	domain.EnvironmentFieldName: {
		SQLName:  "name",
		Accessor: func(e *domain.Environment) any { return e.Name },
		Coerce:   database.CoerceString,
	},
	domain.EnvironmentFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(e *domain.Environment) any { return e.CreatedAt },
		Coerce:   database.CoerceTime,
	},
})
