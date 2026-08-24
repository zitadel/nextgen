package api

import (
	"context"
	"errors"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateSchema(ctx context.Context, req api.CreateSchemaReq, params api.CreateSchemaParams) (api.CreateSchemaRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), schemaAccess, opWrite); err != nil {
		return nil, err
	}
	var schema *domain.JSONSchema

	switch req.Type {
	case api.UserSchemaCreateSchemaReq:
		schemabs, err := req.UserSchema.MarshalJSON()
		if err != nil {
			return nil, err
		}
		schema, err = h.schemaService.CreateSchema(ctx,
			service.CreateSchemaInput{
				ProjectID: string(params.ProjectID),
				TeamID:    string(params.TeamID.Value),
				Schema:    schemabs,
			})
		if err != nil {
			return nil, err
		}
		return &api.CreateSchemaResponse{ID: schema.URL}, nil
	case api.SchemaURLCreateSchemaReq:
		schema, err := h.schemaService.CreateSchemaByUrl(ctx,
			service.CreateSchemaByURLInput{
				ProjectID: string(params.ProjectID),
				TeamID:    string(params.TeamID.Value),
				URL:       req.SchemaURL.URL,
			})
		if err != nil {
			return nil, err
		}
		return &api.CreateSchemaResponse{ID: schema.URL}, nil
	default:
		return nil, unknownSchemaKindError
	}
}

func (h *Handler) GetSchemaById(ctx context.Context, params api.GetSchemaByIdParams) (api.GetSchemaByIdRes, error) {
	projectID, err := h.requireResourceAccess(ctx, params.ID, schemaAccess, opRead)
	if err != nil {
		return nil, err
	}
	schema, err := h.schemaService.GetSchema(ctx, projectID, string(params.TeamID.Value), params.ID)
	if err != nil {
		return nil, err
	}

	apiSchema, err := domainSchemaToApiSchema(schema)
	if err != nil {
		return nil, err
	}
	return apiSchema, nil
}

func (h *Handler) ListSchemas(ctx context.Context, params api.ListSchemasParams) (api.ListSchemasRes, error) {
	ctx, err := h.requireProjectListAccess(ctx, string(params.ProjectID), schemaAccess, domain.ResourceKindSchema)
	if err != nil {
		return nil, err
	}
	// The wire enum and the domain enum carry the same values, but the mapping
	// is explicit so an added kind cannot silently pass through unrecognised.
	var kind *domain.JSONSchemaKind
	if params.Kind.Set {
		parsed, err := domain.JSONSchemaKindString(string(params.Kind.Value))
		if err != nil {
			return nil, err
		}
		kind = &parsed
	}

	schemas, err := h.schemaService.ListSchemas(ctx,
		string(params.ProjectID),
		params.ObjectType.Value,
		kind,
		params.Offset.Value,
		string(params.PageToken.Value),
	)
	if err != nil {
		return nil, err
	}

	resp := api.ListSchemasResponse{Schemas: make([]api.Schema, len(schemas))}
	for i, schema := range schemas {
		apiSchema, err := domainSchemaToApiSchema(schema)
		if err != nil {
			return nil, err
		}
		resp.Schemas[i] = *apiSchema
	}

	return &resp, nil
}

// domainSchemaToApiSchema wraps the stored customer-authored document in the
// server-owned envelope; every schema read goes through it.
func domainSchemaToApiSchema(schema *domain.JSONSchema) (*api.Schema, error) {
	document := api.UserSchema{}
	if err := document.UnmarshalJSON(schema.Schema); err != nil {
		return nil, err
	}

	return &api.Schema{
		ID:       schema.URL,
		Schema:   api.NewUserSchemaSchemaDocument(document),
		Metadata: api.SchemaMetadata{CreatedAt: schema.CreatedAt},
	}, nil
}

// ------------------ Errors ---------------

func schemaErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrJSONSchemaNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrJSONSchemaAlreadyExists().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrJSONSchemaInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrJSONSchemaPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}

var unknownSchemaKindError = errors.New("unknown kind of schema")
