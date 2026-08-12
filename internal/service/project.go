package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/ianlancetaylor/jsonschema"

	"github.com/zitadel/nextgen/api/openapi/endpoints/flow_definitions"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const projectFieldCreatedAt = "created_at"

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

	// DefaultProject resolves the project a standalone deployment tracks
	// (Console ADR 0004 §3): the configured project when cfgProjectID is
	// set — which must exist; a missing configured project is a
	// configuration error — otherwise the deployment's first-created
	// project. Returns (nil, nil) while no project exists yet: the server
	// never creates the default project, the customer's integration
	// (`zitadel setup` → POST /projects) does.
	DefaultProject(ctx context.Context, cfgProjectID string) (*domain.Project, error)

	// Update updates the name of a project.
	// Returns domain.ErrProjectMissingID or domain.ErrProjectNameInvalid for validation failures.
	// Returns domain.ErrProjectNotFound when no project with the given ID exists; other failures return domain.ErrInternal.
	Update(ctx context.Context, id, name string) (*domain.Project, error)

	// List returns projects matching the request, ordered and paginated with an
	// opaque cursor token. The returned NextPageToken is empty when the last page
	// has been reached.
	// Returns domain.ErrProjectMissingID when the request carries no project.
	List(ctx context.Context, req ListProjectsRequest) (*ListProjectsResponse, error)

	// Delete hard-deletes a project, cascading to its child resources through the
	// storage delete. Deleting a project that does not exist is a no-op.
	Delete(ctx context.Context, id string) error
}

// NewProjectService returns a [ProjectService] backed by the given repository.
func NewProjectService(
	v2Pool *DB,
	serverURL string,
	schemaValidator *domain.SchemaValidator,
	keyService KeyService,
) ProjectService {
	return &projectService{
		v2Pool:          v2Pool,
		serverURL:       serverURL,
		schemaValidator: schemaValidator,
		keyService:      keyService,
	}
}

type projectService struct {
	v2Pool          *DB
	serverURL       string
	schemaValidator *domain.SchemaValidator
	keyService      KeyService
}

var _ ProjectService = (*projectService)(nil)

func (s *projectService) Create(ctx context.Context, name string, previewOrigins []string, seedDefaults bool) (_ *domain.Project, err error) {
	project, err := domain.NewProject(name, previewOrigins)
	if err != nil {
		return nil, err
	}

	masterKey, err := s.keyService.GetMasterKeyCrypter(ctx)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get master key")
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateProject(ctx, project); err != nil {
			if mapped := mapStorageError(err); mapped != err {
				return mapped
			}
			return domain.ErrInternal(err).WithMessage("failed to create project in the database")
		}

		keyset, err := project.GenerateNewKeySet(masterKey, func(prefix domain.ResourcePrefix) (string, error) {
			return tx.Statements().NewManagedID(string(prefix))
		})
		if err != nil {
			return err
		}
		keyset.Activate(nil)

		if err := tx.Statements().CreateEncryptionKey(ctx, keyset.KeyEncryptionKey); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project key encryption key in the database")
		}
		if err := tx.Statements().CreateEncryptionKey(ctx, keyset.TokenEncryptionKey); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project token encryption key in the database")
		}
		if err := tx.Statements().CreateEncryptionKey(ctx, keyset.SecretEncryptionKey); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project secret encryption key in the database")
		}
		if err := tx.Statements().CreateEncryptionKey(ctx, keyset.CookieEncryptionKey); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project cookie encryption key in the database")
		}
		if err := tx.Statements().CreateSigningKey(ctx, keyset.TokenSigningKey); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to create project token signing key in the database")
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
		return s.createDefaultLoginFlowDefinitions(ctx, tx.Statements(), project.ID, userSchema)
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

func (s *projectService) createDefaultLoginFlowDefinitions(ctx context.Context, stmts FlowDefinitionStatements, projectID string, userSchema *jsonschema.Schema) error {
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

		err = stmts.CreateFlowDefinition(ctx, flowDef)
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

func (s *projectService) DefaultProject(ctx context.Context, cfgProjectID string) (*domain.Project, error) {
	if cfgProjectID != "" {
		project, err := s.Get(ctx, cfgProjectID)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return nil, domain.ErrProjectNotFound().
					WithMessage("configured platform.project_id does not exist").
					WithDetails(cfgProjectID)
			}
			return nil, err
		}
		return project, nil
	}

	// The deployment's first-created project is the default. Deterministic
	// (created_at ascending) so every replica answers the same, and cheap
	// enough to resolve per runtime.json request — no cached state to
	// invalidate when `zitadel setup` creates the first project.
	result, err := s.v2Pool.Statements().ListProjects(ctx, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			Limit: 1,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldCreatedAt)},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, mapStorageError(err)
	}
	if result == nil || len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

func (s *projectService) Update(ctx context.Context, id, name string) (*domain.Project, error) {
	if id == "" {
		return nil, domain.ErrProjectMissingID()
	}
	name = strings.TrimSpace(name)
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
	// ProjectID restricts results to that single project. Handlers set it from
	// the caller's scope, and every credential today is bound to one project.
	// Required.
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
	// TODO (grvijayan): update once a credential can hold a scope wider than one project (ADR 036).
	if req.ProjectID == "" {
		return nil, domain.ErrProjectMissingID()
	}

	filters := make([]database.Filter[domain.ProjectField], 0, len(req.Filters)+1)
	filters = append(filters, database.Equal(database.Col(domain.ProjectFieldID), req.ProjectID))
	for _, f := range req.Filters {
		filter, err := projectFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}

	orderBy, err := listOrderBy(req.Sorting, domain.ProjectFieldCreatedAt, database.OrderAsc, projectField, domain.ProjectFieldID)
	if err != nil {
		return nil, err
	}

	var cursor []byte
	if req.PageToken != "" {
		cursor = []byte(req.PageToken)
	}

	opts := &database.ListOptions[domain.ProjectField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.ProjectField]{
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

// projectFilter maps an API filter predicate to a storage filter. Operations the
// v2 filter layer cannot express return [domain.ErrNotImplemented];
// invalid field/operation/value combinations return [domain.ErrRequestInvalid].
func projectFilter(f Filter) (database.Filter[domain.ProjectField], error) {
	field, err := projectField(f.Field)
	if err != nil {
		return nil, err
	}
	return createdAtFilter(f.Operation, database.Col(field), f.Value)
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
		return domain.ErrProjectMissingID()
	}
	if err := s.v2Pool.Statements().DeleteProjectByID(ctx, id); err != nil {
		return domain.ErrInternal(err).WithMessage("failed to delete project")
	}
	return nil
}
