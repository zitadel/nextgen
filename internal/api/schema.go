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
	var schema *domain.JSONSchema

	switch req.Type {
	case api.UserSchemaCreateSchemaReq:
		schemabs, err := req.UserSchema.MarshalJSON()
		if err != nil {
			return nil, err
		}
		schema, err = h.schemaService.CreateSchema(ctx,
			service.CreateSchemaInput{
				ProjectID: string(params.ProjectID.Value),
				TeamID:    string(params.TeamID.Value),
				SchemaID:  req.UserSchema.ID.String(),
				Schema:    schemabs,
			})
		if err != nil {
			return nil, err
		}
		return &api.CreateSchemaResponse{ID: schema.URL}, nil
	case api.SchemaURLCreateSchemaReq:
		schema, err := h.schemaService.CreateSchemaByUrl(ctx,
			service.CreateSchemaByURLInput{
				ProjectID: string(params.ProjectID.Value),
				TeamID:    string(params.TeamID.Value),
				URL:       req.SchemaURL.URL,
			})
		if err != nil {
			return nil, err
		}
		return &api.CreateSchemaResponse{ID: schema.URL}, nil
	default:
		return nil, UnknownSchemaKindError
	}
}

func (h *Handler) GetSchemaById(ctx context.Context, params api.GetSchemaByIdParams) (api.GetSchemaByIdRes, error) {
	schema, err := h.schemaService.GetSchema(ctx, string(params.ProjectID.Value), string(params.TeamID.Value), params.ID)
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

// ------------------ Errors ---------------

func schemaErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrJSONSchemaNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrJSONSchemaAlreadyExists().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}

var UnknownSchemaKindError = errors.New("unknown kind of schema")
