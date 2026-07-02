package spanner

import (
	"context"
	"strconv"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type flowDefinitionStatements struct{ statement }

// CreateFlowDefinition implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	panic("unimplemented")
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, id string) error {
	panic("unimplemented")
}

// GetFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) GetFlowDefinitionByID(ctx context.Context, id string) (*domain.FlowDefinition, error) {
	panic("unimplemented")
}

// ListFlowDefinitions implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
	panic("unimplemented")
}

// IsStatements implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) IsStatements() {}

func newFlowDefinitionStatements(client queryExecutor) flowDefinitionStatements {
	return flowDefinitionStatements{
		statement: statement{
			client: client,
		},
	}
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)

func parseFlowDefinitionPurposeKey(s string) (domain.FlowDefinitionPurpose, error) {
	if purpose, err := domain.FlowDefinitionPurposeString(s); err == nil {
		return purpose, nil
	}
	n, err := strconv.ParseUint(s, 10, 8)
	if err != nil {
		return 0, database.ErrInvalidEnumKey(s)
	}
	return domain.FlowDefinitionPurpose(n), nil
}

var flowDefinitionSchema = database.NewSchema(map[domain.FlowDefinitionField]database.FieldBinding[domain.FlowDefinition]{
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
		SQLName:  "status",
		Accessor: func(d *domain.FlowDefinition) any { return d.Status },
		Coerce:   database.CoerceNumber[domain.FlowDefinitionStatus],
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
	domain.FlowDefinitionFieldUserSchema: {
		SQLName:  "user_schema",
		Accessor: func(d *domain.FlowDefinition) any { return d.UserSchema },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldPurposes: {
		SQLName:  "purposes",
		Accessor: func(d *domain.FlowDefinition) any { return d.Purposes },
		Coerce:   database.CoerceEnumKeyMapAsAny[domain.FlowDefinitionPurpose, string](parseFlowDefinitionPurposeKey),
	},
	domain.FlowDefinitionFieldAudience: {
		SQLName:  "audience",
		Accessor: func(d *domain.FlowDefinition) any { return d.Audience },
		Coerce:   database.CoerceJSON[domain.FlowDefinitionAudience],
	},
	domain.FlowDefinitionFieldSteps: {
		SQLName:  "steps",
		Accessor: func(d *domain.FlowDefinition) any { return d.Steps },
		Coerce:   database.CoerceSliceAsAny(database.CoerceJSONValue[domain.FlowDefinitionStep]),
	},
})
