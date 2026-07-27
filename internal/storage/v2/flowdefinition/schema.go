package flowdefinition

import (
	"strconv"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// ParsePurposeKey parses a purposes map key from a cursor token.
func ParsePurposeKey(s string) (domain.FlowDefinitionPurpose, error) {
	if purpose, err := domain.FlowDefinitionPurposeString(s); err == nil {
		return purpose, nil
	}
	n, err := strconv.ParseUint(s, 10, 8)
	if err != nil {
		return 0, database.ErrInvalidEnumKey(s)
	}
	return domain.FlowDefinitionPurpose(n), nil
}

// Schema binds flow definition list/filter/order fields for both dialects.
// Nested payload (user schema, audience, steps) lives in the definition JSON
// column and is handled by Marshal/ToDomain — not as list Schema columns.
var Schema = database.NewSchema(map[domain.FlowDefinitionField]database.FieldBinding[domain.FlowDefinition]{
	domain.FlowDefinitionFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldID: {
		SQLName:  "id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ID },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldName: {
		SQLName:  "name",
		Accessor: func(d *domain.FlowDefinition) any { return d.Name },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldSchemaVersion: {
		SQLName:  "schema_version",
		Accessor: func(d *domain.FlowDefinition) any { return d.SchemaVersion },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldStatus: {
		SQLName:   "status",
		Accessor:  func(d *domain.FlowDefinition) any { return d.Status.String() },
		Coerce:    database.CoerceString,
		ParamCast: "::zitadel_nextgen.flow_definition_states",
	},
	domain.FlowDefinitionFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.FlowDefinitionFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.FlowDefinitionFieldPurposes: {
		SQLName:   "purposes",
		Accessor:  func(d *domain.FlowDefinition) any { return d.Purposes },
		Coerce:    database.CoerceEnumKeyMapAsAny[domain.FlowDefinitionPurpose, string](ParsePurposeKey),
		ParamCast: "::zitadel_nextgen.flow_definition_purposes",
	},
})
