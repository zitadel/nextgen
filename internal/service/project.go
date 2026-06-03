package service

import (
	"context"
	"encoding/json"

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
	repo domain.ProjectRepository,
	schemaRepo domain.JSONSchemaRepository,
	flowDefinitionRepo domain.FlowDefinitionRepository,
	tokenGenerator domain.TokenGenerator,
	serverURL string,
	schemaValidator *domain.SchemaValidator,
) ProjectService {
	return &projectService{
		pool:               pool,
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
	projectRepo        domain.ProjectRepository
	schemaRepo         domain.JSONSchemaRepository
	flowDefinitionRepo domain.FlowDefinitionRepository
	tokenGenerator     domain.TokenGenerator
	serverURL          string
	schemaValidator    *domain.SchemaValidator
}

var _ ProjectService = (*projectService)(nil)

func (s *projectService) Create(ctx context.Context, previewOrigins []string) (_ *domain.Project, err error) {
	tx, err := s.pool.Begin(ctx, nil)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to start transaction")
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	project, err := domain.NewProject(previewOrigins, s.tokenGenerator)
	if err != nil {
		return nil, err
	}

	if err := s.projectRepo.Create(ctx, tx, project); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create project in the database")
	}

	userschema, err := s.createDefaultUserSchemas(ctx, tx, project.ID)
	if err != nil {
		return nil, err
	}
	var userSchema *jsonschema.Schema
	err = json.Unmarshal(userschema.Schema, &userSchema)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to parse default user schema")
	}
	if err := s.createDefaultLoginFlowDefinitions(ctx, tx, project.ID, userSchema); err != nil {
		return nil, err
	}

	err = tx.Commit(ctx)
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
	return s.projectRepo.Get(ctx, s.pool, id)
}
