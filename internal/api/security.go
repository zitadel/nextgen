package api

import (
	"context"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
)

type SecurityHandler struct {
}

func (s SecurityHandler) HandleUsernamePassword(ctx context.Context, operationName api.OperationName, t api.UsernamePassword) (context.Context, error) {
	//TODO implement me
	panic("implement me")
}

func (s SecurityHandler) HandleOAuth2(ctx context.Context, operationName api.OperationName, t api.OAuth2) (context.Context, error) {
	if t.Token == "" {
		return nil, ogenerrors.ErrSecurityRequirementIsNotSatisfied
	}
	return ctx, nil
}

var _ api.SecurityHandler = (*SecurityHandler)(nil)

func NewSecurityHandler() *SecurityHandler {
	return &SecurityHandler{}
}
