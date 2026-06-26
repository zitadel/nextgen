package postgres

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

var flowDefinitionSchema = database.NewSchema(map[domain.FlowDefinitionField]database.FieldBinding[domain.FlowDefinition]{
	domain.FlowDefinitionFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ProjectID },
	},
	domain.FlowDefinitionFieldID: {
		SQLName:  "id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ID },
	},
	domain.FlowDefinitionFieldName: {
		SQLName:  "name",
		Accessor: func(d *domain.FlowDefinition) any { return d.Name },
	},
	domain.FlowDefinitionFieldSchemaVersion: {
		SQLName:  "schema_version",
		Accessor: func(d *domain.FlowDefinition) any { return d.SchemaVersion },
	},
	domain.FlowDefinitionFieldStatus: {
		SQLName:  "status",
		Accessor: func(d *domain.FlowDefinition) any { return d.Status },
	},
	domain.FlowDefinitionFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.CreatedAt },
	},
	domain.FlowDefinitionFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.UpdatedAt },
	},
	domain.FlowDefinitionFieldUserSchema: {
		SQLName:  "user_schema",
		Accessor: func(d *domain.FlowDefinition) any { return d.UserSchema },
	},
	domain.FlowDefinitionFieldPurposes: {
		SQLName:  "purposes",
		Accessor: func(d *domain.FlowDefinition) any { return d.Purposes },
	},
	domain.FlowDefinitionFieldAudience: {
		SQLName:  "audience",
		Accessor: func(d *domain.FlowDefinition) any { return d.Audience },
	},
	domain.FlowDefinitionFieldSteps: {
		SQLName:  "steps",
		Accessor: func(d *domain.FlowDefinition) any { return d.Steps },
	},
})
