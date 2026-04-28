package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
)

func (h Handler) AuthorizeDevice(ctx context.Context, params api.AuthorizeDeviceParams) (api.AuthorizeDeviceRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) AuthorizeGet(ctx context.Context, params api.AuthorizeGetParams) (api.AuthorizeGetRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) EndSession(ctx context.Context, params api.EndSessionParams) (api.EndSessionRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) GetKeys(ctx context.Context) (api.GetKeysRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) GetToken(ctx context.Context, req *api.PostTokenRequest) (api.GetTokenRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) GetUserInfo(ctx context.Context) (api.GetUserInfoRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) Introspect(ctx context.Context, req *api.IntrospectRequest) (api.IntrospectRes, error) {
	//TODO implement me
	panic("implement me")
}

func (h Handler) RevokeToken(ctx context.Context, req *api.RevokeRequest) (api.RevokeTokenRes, error) {
	//TODO implement me
	panic("implement me")
}
