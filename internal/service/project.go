package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/go-jose/go-jose/v4"
	"github.com/ianlancetaylor/jsonschema"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const projectFieldCreatedAt = "createdAt"

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

	// Update updates the name of a project.
	// Returns domain.ErrMissingProjectID or domain.ErrProjectNameInvalid for validation failures.
	// Returns domain.ErrProjectNotFound when no project with the given ID exists; other failures return domain.ErrInternal.
	Update(ctx context.Context, id, name string) (*domain.Project, error)

	// List returns projects matching the request, ordered and paginated with an
	// opaque cursor token. The returned NextPageToken is empty when the last page
	// has been reached.
	List(ctx context.Context, req ListProjectsRequest) (*ListProjectsResponse, error)

	// Delete hard-deletes a project, cascading to its child resources through the
	// storage delete. Deleting a project that does not exist is a no-op.
	Delete(ctx context.Context, id string) error
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

func (s *projectService) Update(ctx context.Context, id, name string) (*domain.Project, error) {
	if id == "" {
		return nil, domain.ErrMissingProjectID()
	}
	if name == "" {
		return nil, domain.ErrProjectNameInvalid()
	}
	project := &domain.Project{
		ID:   id,
		Name: name,
	}
	if err := s.v2Pool.Statements().UpdateProject(ctx, project); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to update project")
	}
	return project, nil
}

// ListProjectsRequest is the input for listing projects.
type ListProjectsRequest struct {
	// ProjectID, if set, restricts results to that single project.
	// It is set based on the scope of the caller.
	// If it's bound to a single project, the ProjectID should be set by the handler.
	// Left empty, the list spans all projects: the handler need not pass a ProjectID
	// if the caller has broader access (e.g., system-level read access).
	ProjectID string
	Limit     int
	PageToken string
	Sorting   *Sorting // optional; defaults to createdAt asc
	Filters   []Filter
}

// ListProjectsResponse is the output for listing projects.
type ListProjectsResponse struct {
	Projects      []*domain.Project
	NextPageToken string
}

func (s *projectService) List(ctx context.Context, req ListProjectsRequest) (*ListProjectsResponse, error) {
	filters := make([]v2database.Filter[domain.ProjectField], 0, len(req.Filters)+1)
	if req.ProjectID != "" {
		filters = append(filters, v2database.Equal(v2database.Col(domain.ProjectFieldID), req.ProjectID))
	}
	for _, f := range req.Filters {
		filter, err := projectFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}

	orderBy, err := projectOrderBy(req.Sorting)
	if err != nil {
		return nil, err
	}

	var cursor []byte
	if req.PageToken != "" {
		cursor = []byte(req.PageToken)
	}

	opts := &v2database.ListOptions[domain.ProjectField]{
		Filter: v2database.And(filters...),
		Pagination: v2database.Page[domain.ProjectField]{
			Limit:   uint32(normalizeLimit(req.Limit)),
			OrderBy: orderBy,
			Cursor:  cursor,
		},
	}

	result, err := s.v2Pool.Statements().ListProjects(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list projects")
	}

	return &ListProjectsResponse{
		Projects:      result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}

// projectOrderBy builds the sort order, defaulting to createdAt ascending, and
// appends id as a tiebreaker so equal sort keys page deterministically.
func projectOrderBy(sorting *Sorting) (v2database.OrderBy[domain.ProjectField], error) {
	sortField := domain.ProjectFieldCreatedAt
	direction := v2database.OrderAsc

	if sorting != nil {
		if sorting.Field != "" {
			f, err := projectField(sorting.Field)
			if err != nil {
				return v2database.OrderBy[domain.ProjectField]{}, err
			}
			sortField = f
		}
		dir, err := parseSortDirection(sorting.Direction)
		if err != nil {
			return v2database.OrderBy[domain.ProjectField]{}, err
		}
		direction = dir
	}

	columns := []v2database.Column[domain.ProjectField]{v2database.Col(sortField)}
	// id is unique, so appending it gives the sort a total order. Without it,
	// rows sharing a sort-key value (e.g. equal createdAt) have no stable
	// order, and cursor pagination could skip or repeat them across pages.
	if sortField != domain.ProjectFieldID {
		columns = append(columns, v2database.Col(domain.ProjectFieldID))
	}
	return v2database.OrderBy[domain.ProjectField]{Columns: columns, Direction: direction}, nil
}

// projectFilter maps an API filter predicate to a storage filter. Operations the
// v2 filter layer cannot express return [domain.ErrNotImplemented];
// invalid field/operation/value combinations return [domain.ErrRequestInvalid].
func projectFilter(f Filter) (v2database.Filter[domain.ProjectField], error) {
	field, err := projectField(f.Field)
	if err != nil {
		return nil, err
	}

	raw, ok := f.Value.(string)
	if !ok {
		return nil, domain.ErrRequestInvalid().WithDetails("createdAt filter value must be an RFC3339 string")
	}
	// The createdAt filter value arrives as an untyped string (the filter-value union in the openapi contract
	// does not specify a format for a timestamp); parse it into the time.Time needed for the comparison.
	value, err := v2database.CoerceTimeValue(raw)
	if err != nil {
		return nil, domain.ErrRequestInvalid().WithDetails("createdAt filter value must be a valid RFC3339 timestamp")
	}
	return compareFilter(f.Operation, v2database.Col(field), value)
}

// projectField maps an API field name to its [domain.ProjectField].
func projectField(field string) (domain.ProjectField, error) {
	switch field {
	case projectFieldCreatedAt:
		return domain.ProjectFieldCreatedAt, nil
	default:
		return domain.ProjectFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
}

func (s *projectService) Delete(ctx context.Context, id string) error {
	if id == "" {
		return domain.ErrMissingProjectID()
	}
	if err := s.v2Pool.Statements().DeleteProjectByID(ctx, id); err != nil {
		return domain.ErrInternal(err).WithMessage("failed to delete project")
	}
	return nil
}
