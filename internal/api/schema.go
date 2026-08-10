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

	apiSchema := api.UserSchema{}
	err = apiSchema.UnmarshalJSON(schema.Schema)
	if err != nil {
		return nil, err
	}

	return &api.GetSchemaByIdOK{
		Type:       api.UserSchemaGetSchemaByIdOK,
		UserSchema: apiSchema,
	}, nil
}

func (h *Handler) ListSchemas(ctx context.Context, params api.ListSchemasParams) (api.ListSchemasRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), schemaAccess, opRead); err != nil {
		return nil, err
	}
	schemas, err := h.schemaService.ListSchemas(ctx,
		string(params.ProjectID),
		params.ObjectType.Value,
		params.Offset.Value,
		string(params.PageToken.Value),
	)
	if err != nil {
		return nil, err
	}

	resp := make(api.ListSchemasResponse, len(schemas), len(schemas))

	for i, schema := range schemas {
		resp[i] = api.ListSchemasResponseItem{
			ID:        schema.ID,
			CreatedAt: schema.CreatedAt,
		}
	}

	return &resp, nil
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
