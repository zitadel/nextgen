package api

import (
	"context"
	"net/url"

	"github.com/pkg/errors"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/convert"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateSchema(ctx context.Context, req api.CreateSchemaReq, params api.CreateSchemaParams) (api.CreateSchemaRes, error) {
	var err error
	var id *url.URL

	switch req.Type {
	case api.UserSchemaCreateSchemaReq:
		sch, err := convert.UserSchemaToJsonschema(req.UserSchema)
		if err != nil {
			return nil, err
		}
		id, err = h.schemaService.CreateSchema(ctx, string(params.ProjectID.Value), string(params.TeamID.Value), sch)
	case api.SchemaURLCreateSchemaReq:
		id = &req.SchemaURL.URL
		err = h.schemaService.CreateSchemaByUrl(ctx, string(params.ProjectID.Value), string(params.TeamID.Value), req.SchemaURL.URL)
	default:
		return nil, UnknownSchemaKindError
	}

	if err != nil {
		return h.createSchemaError(err)
	}
	if id == nil {
		return nil, nil
	}

	return &api.CreateSchemaResponse{ID: *id}, nil
}

func (h *Handler) createSchemaError(err error) (api.CreateSchemaRes, error) {
	if errors.Is(err, service.SchemaAlreadyExistsError) {
		return &api.CreateSchemaConflict{Code: "err-schema-already-exists"}, nil
	}

	var invalidError service.InvalidJsonSchemaError
	if errors.As(err, &invalidError) {
		return &api.CreateSchemaBadRequest{
			Code:    "err-schema-invalid",
			Message: err.Error(),
		}, nil
	}

	return nil, err
}

func (h *Handler) GetSchemaById(ctx context.Context, params api.GetSchemaByIdParams) (api.GetSchemaByIdRes, error) {
	uri, err := url.Parse(domain.SchemaRootUrl + params.ID)
	if err != nil {
		return nil, err
	}

	schema, err := h.schemaService.GetSchema(ctx, string(params.ProjectID.Value), string(params.TeamID.Value), *uri)
	if err != nil {
		return h.getSchemaByIdError(err)
	}

	apiSchema, err := convert.JsonschemaToUserSchema(schema)
	if err != nil {
		return nil, err
	}

	return &api.GetSchemaByIdOK{
		Type:       api.UserSchemaGetSchemaByIdOK,
		UserSchema: *apiSchema,
	}, nil
}

func (h *Handler) getSchemaByIdError(err error) (api.GetSchemaByIdRes, error) {
	if errors.Is(err, service.SchemaNotFoundError) {
		return &api.GetSchemaByIdNotFound{Code: "err-schema-not-found"}, nil
	}

	return nil, err
}

// ------------------ Errors ---------------

var UnknownSchemaKindError = errors.New("unknown kind of schema")
