package service

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/ianlancetaylor/jsonschema"
	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectService is the project use-case surface.
type ProjectService interface {
	// Create generates a new project with server-minted secrets and persists it.
	// Returns the stored project including timestamps.
	Create(ctx context.Context, previewOrigins []string) (*domain.Project, error)

	// Get retrieves a project by ID.
	// Returns [database.NoRowFoundError] when no project with the given ID exists.
	Get(ctx context.Context, id string) (*domain.Project, error)
}

// NewProjectService returns a [ProjectService] backed by the given repository.
func NewProjectService(
	pool database.Pool,
	v2Pool *DB,
	repo domain.ProjectRepository,
	schemaRepo domain.JSONSchemaRepository,
	flowDefinitionRepo domain.FlowDefinitionRepository,
	tokenGenerator domain.TokenGenerator,
	serverURL string,
	schemaValidator *domain.SchemaValidator,
) ProjectService {
	return &projectService{
		pool:               pool,
		v2Pool:             v2Pool,
		projectRepo:        repo,
		schemaRepo:         schemaRepo,
		flowDefinitionRepo: flowDefinitionRepo,
		tokenGenerator:     tokenGenerator,
		serverURL:          serverURL,
		schemaValidator:    schemaValidator,
	}
}

type projectService struct {
	pool               database.Pool
	v2Pool             *DB
	projectRepo        domain.ProjectRepository
	schemaRepo         domain.JSONSchemaRepository
	flowDefinitionRepo domain.FlowDefinitionRepository
	tokenGenerator     domain.TokenGenerator
	serverURL          string
	schemaValidator    *domain.SchemaValidator
}

var _ ProjectService = (*projectService)(nil)

func (s *projectService) Create(ctx context.Context, previewOrigins []string) (_ *domain.Project, err error) {
	project, err := domain.NewProject(previewOrigins, s.tokenGenerator)
	if err != nil {
		return nil, err
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateProject(project).Execute(ctx); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project in the database")
		}

		userschema, err := s.createDefaultUserSchemas(ctx, tx.(database.QueryExecutor), project.ID)
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
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}
	return project, nil
}

func (s *projectService) createDefaultUserSchemas(ctx context.Context, client database.QueryExecutor, projectID string) (*domain.JSONSchema, error) {
	schemabs := schemas.DefaultHumanUserSchema(s.serverURL)
	schema, err := domain.NewJSONSchema(projectID, schemabs)
	if err != nil {
		return nil, err
	}
	if err = s.schemaValidator.ValidateAgainstMetaSchema(schemabs); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("default human user schema invalid")
	}
	if err := s.schemaRepo.Create(ctx, client, schema); err != nil {
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
	return s.v2Pool.Statements().GetProjectByID(id).Query(ctx)
}
