package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowCreateUserForPasskeyHandler creates the user row on the passkey-register
// verify leg using the userID bound to the WebAuthn challenge at issue time.
// NOTE: user creation currently runs in a separate transaction from passkey registration persistence.
type FlowCreateUserForPasskeyHandler struct {
	userService *UserService
	schemaRepo  domain.JSONSchemaRepository
}

func NewFlowCreateUserForPasskeyHandler(
	userService *UserService,
	schemaRepo domain.JSONSchemaRepository,
) *FlowCreateUserForPasskeyHandler {
	return &FlowCreateUserForPasskeyHandler{
		userService: userService,
		schemaRepo:  schemaRepo,
	}
}

func (h *FlowCreateUserForPasskeyHandler) CreateProvisionalUser(ctx context.Context, userID string, state *domain.FlowState) error {
	state.CollectedData.UserData["$schema"] = state.UserSchemaURL
	action := NewCreateUserAction(
		CreateUserInput{
			ProjectID: state.ProjectID,
			User:      state.CollectedData.UserData,
			ID:        userID,
		},
		h.schemaRepo,
	)
	err := h.userService.ApplyActions(ctx, action)
	if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
		return nil
	}
	return err
}
