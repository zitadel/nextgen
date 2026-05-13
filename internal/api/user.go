package api

import (
	"context"

	ht "github.com/ogen-go/ogen/http"
	api "github.com/zitadel/nextgen/api/generated"
)

func (h *Handler) CreateUser(ctx context.Context, req *api.User) (r api.CreateUserRes, _ error) {
	return r, ht.ErrNotImplemented
}

func (h *Handler) ListUsers(ctx context.Context, params api.ListUsersParams) (r api.ListUsersRes, _ error) {
	return r, ht.ErrNotImplemented
}
