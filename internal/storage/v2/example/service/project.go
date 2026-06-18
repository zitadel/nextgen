package service

import (
	"context"
	"encoding/json"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func CreateProject(ctx context.Context, previewOrigins []string) (*domain.Project, error) {
	project, err := domain.NewProject(previewOrigins, nil)
	if err != nil {
		return nil, err
	}

	// tx, err := s.pool.Begin(ctx, nil)
	// if err != nil {
	// 	return nil, domain.ErrInternal(err).WithMessage("failed to start transaction")
	// }
	// defer func() {
	// 	if err != nil {
	// 		_ = tx.Rollback(ctx)
	// 	}
	// }()
	err = pool.Transaction(ctx, func(ctx context.Context, tx database.Statementer) error {

		// if err := s.projectRepo.Create(ctx, tx, project); err != nil {
		// 	return nil, domain.ErrInternal(err).WithMessage("failed to create project in the database")
		// }
		if err := tx.CreateProject(project).Execute(ctx); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project in the database")
		}

		userschema, err := createDefaultUserSchemas(ctx, tx, project.ID)
		if err != nil {
			return nil, err
		}
		var userSchema *jsonschema.Schema
		err = json.Unmarshal(userschema.Schema, &userSchema)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to parse default user schema")
		}
		return createDefaultLoginFlowDefinitions(ctx, tx, project.ID, userSchema)
	})
	if err != nil {
		return nil, err
	}
	return project, nil
}

func createDefaultLoginFlowDefinitions(ctx context.Context, client database.Statementer, projectID string, userSchema *jsonschema.Schema) error {
	flowDefs, err := flow_definitions.DefaultLoginFlowDefinitions(
		"s.serverURL",
		projectID,
		schemas.DefaultHumanUserSchemaURL("s.serverURL"),
	)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to retrieve default flow definition")
	}
	for _, flowDef := range flowDefs {
		_, err = domain.ValidateFlowDefinition(userSchema, *flowDef)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("default login flow definition is invalid")
		}

		err = client.CreateFlowDefinition(flowDef).Execute(ctx)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to save default login flow definition to project")
		}
	}
	return nil
}

func createDefaultUserSchemas(ctx context.Context, client database.Statementer, projectID string) (*domain.JSONSchema, error) {
	schemabs := schemas.DefaultHumanUserSchema("s.serverURL")
	schema, err := domain.NewJSONSchema(projectID, schemabs)
	if err != nil {
		return nil, err
	}
	if err = s.schemaValidator.ValidateAgainstMetaSchema(schemabs); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("default human user schema invalid")
	}
	if err := client.CreateJSONSchema(schema).Execute(ctx); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to save default human schema to project")
	}
	return schema, nil
}
