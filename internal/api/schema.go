package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
)

func (h Handler) CreateSchema(ctx context.Context, req api.CreateSchemaReq) (api.CreateSchemaRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) CreateSchemaRevision(ctx context.Context, req api.CreateSchemaRevisionReq, params api.CreateSchemaRevisionParams) (api.CreateSchemaRevisionRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) GetSchemaById(ctx context.Context, params api.GetSchemaByIdParams) (api.GetSchemaByIdRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) GetSchemaReleaseState(ctx context.Context, params api.GetSchemaReleaseStateParams) (api.GetSchemaReleaseStateRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) GetSchemaRevisionById(ctx context.Context, params api.GetSchemaRevisionByIdParams) (api.GetSchemaRevisionByIdRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) UpdateSchemaReleaseState(ctx context.Context, req api.SchemaReleaseState, params api.UpdateSchemaReleaseStateParams) (api.UpdateSchemaReleaseStateRes, error) {
	//TODO implement me
	panic("implement me")
}
