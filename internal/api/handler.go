package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
)

type Handler struct {
}

func (h Handler) CreateUserDefinition(ctx context.Context, req *api.CreateUserDefinitionRequest) (api.CreateUserDefinitionRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) GetUserDefinitionById(ctx context.Context, params api.GetUserDefinitionByIdParams) (api.GetUserDefinitionByIdRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) ListUserDefinitions(ctx context.Context) (api.ListUserDefinitionsRes, error) {
	//TODO implement me
	panic("implement me")
}

func NewHandler() *Handler {
	return &Handler{}
}

func (h Handler) NewError(ctx context.Context, err error) *api.ErrorDetailsStatusCode {
	return &api.ErrorDetailsStatusCode{
		StatusCode: 401,
		Response: api.ErrorDetails{
			Code:    "auth error",
			Message: err.Error(),
		},
	}
}

var _ api.Handler = (*Handler)(nil)
