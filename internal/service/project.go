package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/go-jose/go-jose/v4"
	"github.com/ianlancetaylor/jsonschema"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectService is the project use-case surface.
type ProjectService interface {
	// Create generates a new project with server-minted secrets and persists it.
	// If seedDefaults is true, server fallback schema and flow resources are
	// created with the project for non-CLI creation paths.
	// Returns the stored project including timestamps.
	Create(ctx context.Context, name string, previewOrigins []string, seedDefaults bool) (*domain.Project, error)

	// Get retrieves a project by ID.
	// Returns [database.NoRowFoundError] when no project with the given ID exists.
	Get(ctx context.Context, id string) (*domain.Project, error)
}

// NewProjectService returns a [ProjectService] backed by the given repository.
func NewProjectService(
	v2Pool *DB,
	flowDefinitionRepo domain.FlowDefinitionRepository,
	serverURL string,
	schemaValidator *domain.SchemaValidator,
	keyService KeyService,
) ProjectService {
	return &projectService{
		v2Pool:             v2Pool,
		flowDefinitionRepo: flowDefinitionRepo,
		serverURL:          serverURL,
		schemaValidator:    schemaValidator,
		keyService:         keyService,
	}
}

type projectService struct {
	pool               database.Pool
	v2Pool             *DB
	flowDefinitionRepo domain.FlowDefinitionRepository
	serverURL          string
	schemaValidator    *domain.SchemaValidator
	keyService         KeyService
}

var _ ProjectService = (*projectService)(nil)

func (s *projectService) Create(ctx context.Context, name string, previewOrigins []string, seedDefaults bool) (_ *domain.Project, err error) {
	project, err := domain.NewProject(name, previewOrigins)
	if err != nil {
		return nil, err
	}

	kek, err := s.keyService.GetKekCrypter(ctx)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get kek")
	}

	dek, err := domain.NewDEK(project.ID, jose.A256GCM, kek)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create project encryption key")
	}
	dek.Activate(nil)

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateProject(ctx, project); err != nil {
			if mapped := mapStorageError(err); mapped != err {
				return mapped
			}
			return domain.ErrInternal(err).WithMessage("failed to create project in the database")
		}

		if err := tx.Statements().CreateEncryptionKey(ctx, dek); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project encryption key in the database")
		}

		if !seedDefaults {
			return nil
		}

		userschema, err := s.createDefaultUserSchemas(ctx, tx.Statements(), project.ID)
		if err != nil {
			return err
		}
		var userSchema *jsonschema.Schema
		err = json.Unmarshal(userschema.Schema, &userSchema)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to parse default user schema")
		}
		return s.createDefaultLoginFlowDefinitions(ctx, tx.(database.QueryExecutor), project.ID, userSchema)
	})

	if err != nil {
		err = mapStorageError(err)
		// Callback failures are already domain errors (create/schema/flow). Only
		// wrap unexpected commit/infrastructure failures as commit errors.
		var de domain.Error
		if errors.As(err, &de) {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}
	return project, nil
}

func (s *projectService) createDefaultUserSchemas(ctx context.Context, stmts JSONSchemaStatements, projectID string) (*domain.JSONSchema, error) {
	schemabs := schemas.DefaultHumanUserSchema(s.serverURL)
	schema, err := domain.NewJSONSchema(projectID, schemabs)
	if err != nil {
		return nil, err
	}
	if err = s.schemaValidator.ValidateAgainstMetaSchema(schemabs); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("default human user schema invalid")
	}
	if err := stmts.CreateJSONSchema(ctx, schema); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to save default human schema to project")
	}
	return schema, nil
}

func (s *projectService) createDefaultLoginFlowDefinitions(ctx context.Context, client database.QueryExecutor, projectID string, userSchema *jsonschema.Schema) error {
	flowDefs, err := flow_definitions.DefaultLoginFlowDefinitions(
		s.serverURL,
		projectID,
		schemas.DefaultHumanUserSchemaURL(s.serverURL),
	)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to retrieve default flow definition")
	}
	for _, flowDef := range flowDefs {
		_, err = domain.ValidateFlowDefinition(userSchema, *flowDef)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("default login flow definition is invalid")
		}

		err = s.flowDefinitionRepo.CreateFlowDefinition(ctx, client, flowDef)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to save default login flow definition to project")
		}
	}
	return nil
}

func (s *projectService) Get(ctx context.Context, id string) (*domain.Project, error) {
	logger := getLoggingContext(ctx, "project")
	logger.Info("getting project", slog.String("project_id", id))
	project, err := s.v2Pool.Statements().GetProjectByID(ctx, id)
	return project, mapStorageError(err)
}
