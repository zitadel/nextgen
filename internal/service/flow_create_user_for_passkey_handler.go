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
	userService UserService
	schemaStore domain.JSONSchemaStore
}

func NewFlowCreateUserForPasskeyHandler(
	userService UserService,
	schemaStore domain.JSONSchemaStore,
) *FlowCreateUserForPasskeyHandler {
	return &FlowCreateUserForPasskeyHandler{
		userService: userService,
		schemaStore: schemaStore,
	}
}

func (h *FlowCreateUserForPasskeyHandler) CreateProvisionalUser(ctx context.Context, userID string, state *domain.FlowState) error {
	action := NewCreateUserAction(
		CreateUserInput{
			ProjectID:  state.ProjectID,
			SchemaURL:  state.UserSchemaURL,
			Attributes: state.CollectedData.UserData,
			ID:         userID,
		},
		h.schemaStore,
	)
	err := h.userService.ApplyActions(ctx, action)
	if derr, ok := errors.AsType[domain.Error](err); ok && derr.Code == domain.ErrUserAlreadyExists().Code {
		return nil
	}
	return err
}
