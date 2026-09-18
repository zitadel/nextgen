package environment

import (
	"encoding/json"

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
	domain.EnvironmentFieldClass: {
		SQLName:  "class",
		Accessor: func(e *domain.Environment) any { return e.Class.String() },
		Coerce:   database.CoerceString,
	},
	domain.EnvironmentFieldExpiresAt: {
		SQLName:  "expires_at",
		Accessor: func(e *domain.Environment) any { return database.NullableValue(e.ExpiresAt) },
		Coerce:   database.CoerceTime,
		Nullable: true,
	},
	domain.EnvironmentFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(e *domain.Environment) any { return e.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.EnvironmentFieldCurrentDeploymentID: {
		SQLName:  "current_deployment_id",
		Accessor: func(e *domain.Environment) any { return database.NullableValue(e.CurrentDeploymentID) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
})

// MarshalOrigins encodes the origins for the JSON column. Nil for an
// environment without origins, so live stores NULL rather than [].
func MarshalOrigins(origins []string) ([]byte, error) {
	if len(origins) == 0 {
		return nil, nil
	}
	return json.Marshal(origins)
}

// UnmarshalOrigins decodes the origins column; empty input is no origins.
func UnmarshalOrigins(raw []byte) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var origins []string
	if err := json.Unmarshal(raw, &origins); err != nil {
		return nil, err
	}
	return origins, nil
}
